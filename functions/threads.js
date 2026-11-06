const API = 'https://graph.threads.net/v1.0';

export async function beginThreadsConnect(request, env) {
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET) return json({ error: 'Threads連携設定が未完了です。CloudflareにTHREADS_APP_IDとTHREADS_APP_SECRETを登録してください。' }, 503);
  const state = crypto.randomUUID();
  const redirectUri = new URL('/threads/callback', request.url).toString();
  await env.DRAFTS.put('threads:oauth:' + state, JSON.stringify({ redirectUri, createdAt: Date.now() }), { expirationTtl: 600 });
  const url = new URL('https://threads.net/oauth/authorize');
  url.searchParams.set('client_id', env.THREADS_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'threads_basic,threads_content_publish,threads_manage_insights');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return json({ url: url.toString() });
}

export async function finishThreadsConnect(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const saved = state ? await env.DRAFTS.get('threads:oauth:' + state, 'json') : null;
  if (!saved || !code || Date.now() - saved.createdAt > 600000) return new Response('連携を確認できませんでした。アプリに戻ってもう一度接続してください。', { status: 400 });
  await env.DRAFTS.delete('threads:oauth:' + state);
  const form = new URLSearchParams({ client_id: env.THREADS_APP_ID, client_secret: env.THREADS_APP_SECRET, grant_type: 'authorization_code', redirect_uri: saved.redirectUri, code });
  const exchanged = await fetch('https://graph.threads.net/oauth/access_token', { method: 'POST', body: form });
  const auth = await exchanged.json().catch(() => ({}));
  if (!exchanged.ok || !auth.access_token) return Response.redirect(new URL('/?threads=error', request.url), 302);
  const longUrl = new URL('https://graph.threads.net/refresh_access_token');
  longUrl.searchParams.set('grant_type', 'th_exchange_token');
  longUrl.searchParams.set('client_secret', env.THREADS_APP_SECRET);
  longUrl.searchParams.set('access_token', auth.access_token);
  const longResponse = await fetch(longUrl);
  const long = await longResponse.json().catch(() => ({}));
  const token = long.access_token ? long : auth;
  await env.DRAFTS.put('threads:token', JSON.stringify({
    accessToken: token.access_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    userId: String(auth.user_id || ''), username: auth.username || '', connectedAt: new Date().toISOString(),
  }));
  return Response.redirect(new URL('/?threads=connected', request.url), 302);
}

export async function getThreadsStatus(request, env) {
  const blocked = authorize(request, env); if (blocked) return blocked;
  const token = await env.DRAFTS.get('threads:token', 'json');
  const [queue, metrics] = await Promise.all([readPrefix(env, 'threads:q:'), readPrefix(env, 'threads:m:')]);
  const latest = metrics.sort((a,b) => String(b.measuredAt).localeCompare(String(a.measuredAt))).slice(0, 35);
  const totals = latest.reduce((sum, row) => {
    for (const k of ['views','likes','replies','reposts','quotes','shares']) sum[k] += Number(row[k] || 0);
    return sum;
  }, { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 });
  return json({ connected: !!token?.accessToken, username: token?.username || '', queued: queue.filter(x => x.status === 'queued').length, sent: queue.filter(x => x.status === 'published').length, recent: latest.slice(0, 10), totals });
}

export async function enqueueThreadsPosts(env, draft) {
  const posts = (draft.socialPosts || []).filter(x => typeof x === 'string' && x.trim()).slice(0, 7);
  for (let i = 0; i < posts.length; i++) {
    const id = encodeURIComponent(draft.id + ':' + i);
    const key = 'threads:q:' + id;
    if (await env.DRAFTS.get(key)) continue;
    const text = (posts[i].trim() + (draft.noteUrl ? '\\n\\n' + draft.noteUrl : '')).slice(0, 500);
    await env.DRAFTS.put(key, JSON.stringify({ id, draftId: draft.id, title: draft.title, text, noteUrl: draft.noteUrl || '', index: i + 1, status: 'queued', createdAt: new Date().toISOString() }));
  }
}

async function readPrefix(env, prefix) {
  let cursor; const keys = [];
  do { const page = await env.DRAFTS.list({ prefix, limit: 1000, cursor }); keys.push(...page.keys.map(k => k.name)); cursor = page.list_complete ? undefined : page.cursor; } while (cursor);
  const rows = [];
  for (let i=0;i<keys.length;i+=50) {
    const values = await env.DRAFTS.get(keys.slice(i,i+50), 'json');
    rows.push(...[...values.values()].filter(Boolean));
  }
  return rows;
}

async function getFreshToken(env) {
  let token = await env.DRAFTS.get('threads:token', 'json');
  if (!token?.accessToken) return null;
  if (token.expiresAt && token.expiresAt < Date.now() + 10 * 86400000) {
    const url = new URL('https://graph.threads.net/refresh_access_token');
    url.searchParams.set('grant_type','th_refresh_token'); url.searchParams.set('access_token',token.accessToken);
    const r=await fetch(url); const data=await r.json().catch(()=>({}));
    if (r.ok && data.access_token) {
      token={...token,accessToken:data.access_token,expiresAt:Date.now()+Number(data.expires_in||5184000)*1000};
      await env.DRAFTS.put('threads:token',JSON.stringify(token));
    }
  }
  return token;
}

async function graphGet(path, token) {
  const url = new URL(API + path); url.searchParams.set('access_token',token);
  const response = await fetch(url);
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error?.message || 'Threads APIからデータを取得できませんでした');
  return data;
}

async function publishOne(env, token) {
  const queue = (await readPrefix(env,'threads:q:')).filter(x => ['queued','failed'].includes(x.status)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const item=queue[0]; if(!item || (item.attempts||0)>=3) return;
  const key='threads:q:'+item.id;
  try {
    const create = await fetch(API + '/me/threads', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({media_type:'TEXT',text:item.text,access_token:token.accessToken}) });
    const container=await create.json().catch(()=>({}));
    if(!create.ok || !container.id) throw new Error(container.error?.message || 'Threads投稿の準備に失敗しました');
    const publish = await fetch(API + '/me/threads_publish', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({creation_id:container.id,access_token:token.accessToken}) });
    const result=await publish.json().catch(()=>({}));
    if(!publish.ok || !result.id) throw new Error(result.error?.message || 'Threads投稿に失敗しました');
    await env.DRAFTS.put(key,JSON.stringify({...item,status:'published',postId:String(result.id),publishedAt:new Date().toISOString(),attempts:(item.attempts||0)+1}));
  } catch(error) {
    await env.DRAFTS.put(key,JSON.stringify({...item,status:'failed',error:String(error.message||error).slice(0,240),attempts:(item.attempts||0)+1,lastAttemptAt:new Date().toISOString()}));
  }
}

async function collectInsights(env, token) {
  const sent=(await readPrefix(env,'threads:q:')).filter(x=>x.status==='published' && x.postId);
  for(const post of sent.slice(-50)) {
    try {
      const data=await graphGet('/'+encodeURIComponent(post.postId)+'/insights?metric=views,likes,replies,reposts,quotes,shares',token);
      const values={};
      for(const metric of data.data||[]) values[metric.name]=metric.values?.[0]?.value ?? metric.value ?? 0;
      const key='threads:m:'+encodeURIComponent(post.postId);
      const previous=await env.DRAFTS.get(key,'json')||{};
      await env.DRAFTS.put(key,JSON.stringify({...previous,...post,...values,measuredAt:new Date().toISOString()}));
    } catch { /* Metrics may not be available immediately; retry next scheduled run. */ }
  }
}

export async function threadsDailyTick(env) {
  if(!env.THREADS_APP_ID || !env.THREADS_APP_SECRET) return;
  const token=await getFreshToken(env); if(!token) return;
  await collectInsights(env,token);
  await publishOne(env,token);
}

async function json(data,status=200) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
