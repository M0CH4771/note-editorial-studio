const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export function reply(data, status = 200) { return json(data, status); }

export function authorize(request, env) {
  if (!env.APP_PASSWORD) return json({ error: 'サーバー設定がまだ完了していません。管理者がCloudflareの秘密情報を設定してください。' }, 503);
  const supplied = request.headers.get('Authorization') || '';
  if (supplied !== `Bearer ${env.APP_PASSWORD}`) return json({ error: 'パスワードを入力してください。' }, 401);
  if (!env.GEMINI_API_KEY || !env.TAVILY_API_KEY) return json({ error: 'APIキーの設定がまだ完了していません。' }, 503);
  return null;
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AIの返答を読み取れませんでした。もう一度実行してください。');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callGemini(prompt, apiKey, model) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error?.message || `Gemini APIエラー (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return (result.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
}

async function generate(prompt, env) {
  const primary = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const fallback = env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await callGemini(prompt, env.GEMINI_API_KEY, primary); }
    catch (error) {
      lastError = error;
      if (error.status !== 503) throw error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  if (fallback !== primary) {
    try { return await callGemini(prompt, env.GEMINI_API_KEY, fallback); }
    catch (error) { lastError = error; }
  }
  const message = lastError?.status === 429
    ? 'Geminiの無料利用上限に達した可能性があります。Google AI Studioで利用状況を確認してください。'
    : 'Gemini APIが混み合っているか、利用できません。少し時間をおいて再度お試しください。';
  throw Object.assign(new Error(message), { status: lastError?.status || 503 });
}

async function searchWeb(query, env) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, topic: 'general', search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.detail || result.message || `Web検索に失敗しました (${response.status})`), { status: response.status });
  return (result.results || []).map(item => ({ title: item.title || item.url, url: item.url, content: String(item.content || '').slice(0, 1400), checked: new Date().toISOString().slice(0, 10) }));
}

async function researchSources(topic, env, maxQueries) {
  const queryText = await generate(`次のテーマを調べるための日本語Web検索語を作ってください。企画需要、公式情報、読者の具体的な困りごとを調べる語を組み合わせます。\nテーマ: ${topic}\n検索語は最大${maxQueries}件。短く、互いに重複させないでください。\nJSONだけ: {"queries":["検索語1","検索語2"]}`, env);
  const queries = [...new Set((parseJson(queryText).queries || []).map(q => String(q).trim()).filter(Boolean))].slice(0, maxQueries);
  const groups = await Promise.all(queries.map(async query => ({ query, results: await searchWeb(query, env) })));
  const seen = new Set();
  const results = [];
  for (const group of groups) for (const item of group.results) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    results.push({ ...item, query: group.query });
  }
  return { queries, results };
}



function draftKey(draft) { return `draft:${draft.createdAt || new Date().toISOString()}:${draft.id}`; }

export async function saveDraft(env, draft) {
  if (!env.DRAFTS) throw new Error('下書き保存の設定がありません。');
  await env.DRAFTS.put(draftKey(draft), JSON.stringify(draft));
  return draft;
}

export async function listDrafts(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  if (!env.DRAFTS) return json({ drafts: [] });
  try {
    let cursor;
    let latestKeys = [];
    do {
      const page = await env.DRAFTS.list({ prefix: 'draft:', limit: 1000, cursor });
      latestKeys = [...latestKeys, ...page.keys.map(key => key.name)].slice(-300);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const drafts = (await Promise.all(latestKeys.map(key => env.DRAFTS.get(key, 'json')))).filter(Boolean);
    drafts.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return json({ drafts });
  } catch (error) { return json({ error: '下書き一覧を読み込めませんでした。' }, 500); }
}

export async function updateDraft(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  try {
    const draft = await request.json();
    if (!draft?.id || !draft?.title || !draft?.createdAt) return json({ error: '下書きの内容を確認してください。' }, 400);
    draft.updatedAt = new Date().toISOString();
    await saveDraft(env, draft);
    return json({ draft });
  } catch (error) { return json({ error: error.message || '下書きを保存できませんでした。' }, 500); }
}

export async function removeDraft(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const createdAt = url.searchParams.get('createdAt');
    if (!id || !createdAt) return json({ error: '下書き情報がありません。' }, 400);
    await env.DRAFTS.delete(`draft:${createdAt}:${id}`);
    return json({ ok: true });
  } catch (error) { return json({ error: '下書きを削除できませんでした。' }, 500); }
}

export async function createDailyIdeas(env, dateKey) {
  const queries = [
    '生成AI 仕事 活用 最新 公式 日本',
    '副業 在宅ワーク 2026 調査 日本',
    'SNS 集客 アルゴリズム 最新 公式 日本',
    '節約 家計 2026 最新 制度 日本',
  ];
  const groups = await Promise.all(queries.map(async query => ({ query, results: await searchWeb(query, env) })));
  const results = groups.flatMap(group => group.results.map(item => ({ ...item, query: group.query })));
  const text = await generate(`あなたは日本語メディアのリサーチ編集者です。今日公開準備する記事企画を10件作ります。
日付: ${dateKey}
想定読者: 副業、仕事効率化、SNS活用、家計改善に関心がある日本の一般読者
調査結果: ${JSON.stringify(results)}

各案は検索結果で裏付けられる具体的な疑問に答えてください。似た案を避け、10件の切り口を分散させてください。検索結果にない需要や販売実績は推測と明記し、検索量・売上数字を作らないでください。体験談や実績は捏造しないでください。価格100円で読者が得られる具体的な手順、比較表、チェックリストなどを設定してください。
JSONだけ: {"ideas":[{"title":"タイトル案","cluster":"分類","intent":"読者の疑問","hook":"読む理由","deliverable":"100円で渡す具体物","score":0,"confidence":"高/中/低"}]}`, env);
  const ideas = (parseJson(text).ideas || []).slice(0, 10);
  if (ideas.length < 10) throw new Error('今日の企画を10件そろえられませんでした。');
  return ideas.map((idea, index) => ({ ...idea, id: `auto-${dateKey}-${index + 1}`, index: index + 1, date: dateKey, createdAt: new Date().toISOString(), sources: results.slice((index * 2) % results.length, (index * 2) % results.length + 3).map(({ title, url, checked, content, query }) => ({ title, url, checked, supports: content.slice(0, 260), query })) }));
}

export async function createScheduledDraft(idea, env, dateKey) {
  const query = `${idea.title} 最新 公式 情報`;
  const results = await searchWeb(query, env);
  const text = await generate(`あなたはリサーチ重視の日本語編集者です。noteに公開する前の100円記事の下書きを作ってください。
企画: ${JSON.stringify(idea)}
日付: ${dateKey}
検索結果: ${JSON.stringify(results)}

必須: 検索結果で確認できる事実だけを出典と結びつける。体験談、取材、売上、成果、資格を捏造しない。事実・解釈・予測を分け、数字や仕様には確認日を示す。不明点や根拠が弱い点は「要確認」とする。無料部分に対象読者と得られるもの、有料部分に再現可能な手順・表・チェックリストなど具体的な価値を置く。参考URLは検索結果内のものだけ。
JSONだけ: {"title":"タイトル","dek":"説明文","category":"カテゴリ","free_part":"無料部分Markdown","paid_part":"有料部分Markdown","source_urls":[],"fact_check":[{"claim":"主張","status":"確認済/要確認","note":"確認メモ"}],"social_posts":["SNS告知案"],"editor_notes":["公開前確認事項"]}`, env);
  const draft = parseJson(text);
  const sourceMap = new Map(results.map(item => [item.url, item]));
  const cited = [...new Set(draft.source_urls || [])].map(url => sourceMap.get(url)).filter(Boolean);
  const sources = (cited.length ? cited : results.slice(0, 5)).map(s => ({ title: s.title, url: s.url, checked: s.checked, supports: s.content.slice(0, 350) }));
  return {
    id: idea.id, ideaId: idea.id, title: draft.title || idea.title, dek: draft.dek || '',
    category: draft.category || idea.cluster || '', price: 100,
    freePart: draft.free_part || '', paidPart: draft.paid_part || '',
    sources, factCheck: draft.fact_check || [], socialPosts: draft.social_posts || [],
    editorNotes: draft.editor_notes || [], createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), status: 'draft', automated: true, date: dateKey,
  };
}

export async function getStatus(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  return json({ ready: true, model: env.GEMINI_MODEL || 'gemini-3.8-flash' });
}

export async function createIdeas(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  try {
    const body = await request.json();
    const themes = String(body.themes || 'AI活用、SNS運用、副業・在宅ワーク').slice(0, 500);
    const audience = String(body.audience || '副業や仕事の効率化に関心がある一般読者').slice(0, 200);
    const count = Math.max(3, Math.min(8, Number(body.count) || 6));
    const { queries, results } = await researchSources(themes, env, 4);
    const text = await generate(`あなたは日本語メディアのリサーチ編集者です。以下の検索結果だけを材料に、記事にする価値がある企画を${count}件考えてください。\nテーマ: ${themes}\n想定読者: ${audience}\n検索日: ${new Date().toISOString().slice(0, 10)}\n検索語: ${JSON.stringify(queries)}\n検索結果: ${JSON.stringify(results)}\n\nルール:\n- 現在の話題と長く読まれる実用テーマを混ぜる。検索量や販売数が不明なら推測と明記し、数字を作らない。\n- 企画ごとに読者の知りたいこと、需要の根拠、競合、短期/長期、100円で渡せる具体物を示す。\n- 出典URLは検索結果内のものだけ。裏付けられない主張は要確認。体験談や実績を捏造しない。\n- scoreは0〜100の比較用目安。売上予測ではない。\nJSONだけ: {"ideas":[{"title":"記事タイトル案","cluster":"テーマ分類","intent":"検索意図","format":"無料/100円/中価格","hook":"読む理由","deliverable":"具体物","demand_evidence":"根拠と推測の区別","competition":"競合状況","shelf_life":"短期/長期/両方","score":0,"confidence":"高/中/低"}]}`, env);
    const sources = results.slice(0, 8).map(({ title, url, checked, content, query }) => ({ title, url, checked, supports: content.slice(0, 260), query }));
    const ideas = (parseJson(text).ideas || []).slice(0, count).map((idea, i) => ({ ...idea, sources: sources.length ? [...sources.slice((i * 2) % sources.length, (i * 2) % sources.length + 3)] : [], id: crypto.randomUUID(), createdAt: new Date().toISOString(), index: i + 1 }));
    return json({ ideas, searchesUsed: queries.length });
  } catch (error) { return json({ error: error.message || '企画の作成に失敗しました。' }, error.status || 500); }
}

export async function createDraft(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  try {
    const body = await request.json();
    const idea = body.idea;
    if (!idea?.title) return json({ error: '記事のアイデアを選んでください。' }, 400);
    const price = Number(body.price || 100);
    const topic = `${idea.title} ${idea.intent || ''} ${idea.cluster || ''}`;
    const { queries, results } = await researchSources(topic, env, 3);
    const text = await generate(`あなたはリサーチ重視の日本語編集者です。選ばれた企画をnote記事の公開前下書きにしてください。\n企画: ${JSON.stringify(idea)}\n価格: ${price}円\n分量: 標準（約1,500〜2,500字）\n検索日: ${new Date().toISOString().slice(0, 10)}\n検索語: ${JSON.stringify(queries)}\n検索結果: ${JSON.stringify(results)}\n\n必須ルール:\n- 主要な事実を検索結果で確認し、出典と対応させる。体験談、取材、売上、成果、資格を捏造しない。\n- 事実・解釈・予測を分け、数字や仕様は確認日を示し、不明点は要確認とする。\n- 無料部分で対象読者、悩み、得られるものを説明する。100円記事なら具体的な手順・表・チェックリストを有料部分に入れる。\n- 参考URLは検索結果内のものだけ。公開前確認事項とSNS告知案も作る。\nJSONだけ: {"title":"タイトル","dek":"説明","category":"カテゴリ","free_part":"無料部分Markdown","paid_part":"有料部分Markdown","source_urls":[],"fact_check":[{"claim":"主張","status":"確認済/要確認","note":"確認メモ"}],"social_posts":["告知案"],"editor_notes":["公開前確認"]}`, env);
    const draft = parseJson(text);
    const sourceMap = new Map(results.map(item => [item.url, item]));
    const cited = [...new Set(draft.source_urls || [])].map(url => sourceMap.get(url)).filter(Boolean);
    const sources = (cited.length ? cited : results.slice(0, 5)).map(s => ({ title: s.title, url: s.url, checked: s.checked, supports: s.content.slice(0, 350) }));
    const savedDraft = { id: crypto.randomUUID(), ideaId: idea.id || null, title: draft.title || idea.title, dek: draft.dek || '', category: draft.category || idea.cluster || '', price, freePart: draft.free_part || '', paidPart: draft.paid_part || '', sources, factCheck: draft.fact_check || [], socialPosts: draft.social_posts || [], editorNotes: draft.editor_notes || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft' }; await saveDraft(env, savedDraft); return json(savedDraft);
  } catch (error) { return json({ error: error.message || '下書きの作成に失敗しました。' }, error.status || 500); }
}
