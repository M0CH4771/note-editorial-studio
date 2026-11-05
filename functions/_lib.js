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
    return json({ id: crypto.randomUUID(), ideaId: idea.id || null, title: draft.title || idea.title, dek: draft.dek || '', category: draft.category || idea.cluster || '', price, freePart: draft.free_part || '', paidPart: draft.paid_part || '', sources, factCheck: draft.fact_check || [], socialPosts: draft.social_posts || [], editorNotes: draft.editor_notes || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft' });
  } catch (error) { return json({ error: error.message || '下書きの作成に失敗しました。' }, error.status || 500); }
}
