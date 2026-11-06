import { WorkflowEntrypoint } from 'cloudflare:workers';
import { getCoverImage, regenerateCover } from './functions/cover.js';
import { beginThreadsConnect, finishThreadsConnect, getThreadsStatus, threadsDailyTick } from './functions/threads.js';
import {
  authorize, weekly, createDailyIdeas, createDraft, createIdeas, createScheduledDraft, getStatus,
  listDrafts, removeDraft, reply, saveDraft, updateDraft,
} from './functions/_lib.js';

export class DailyDraftWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const manual = event.payload?.manualDraft;
    if (manual) {
      const { jobId, draftId, idea, ideaId, price, dateKey } = manual;
      const jobKey = 'job:' + jobId;
      await this.env.DRAFTS.put(jobKey, JSON.stringify({ jobId, status: 'running', title: idea.title, updatedAt: new Date().toISOString() }), { expirationTtl: 86400 });
      try {
        const result = await step.do('write-manual-' + jobId, { retries: { limit: 1, delay: '1 minute', backoff: 'constant' } }, async () => {
          const draft = await createScheduledDraft({ ...idea, id: draftId, price }, this.env, dateKey);
          draft.id = draftId;
          draft.ideaId = ideaId;
          draft.price = price;
          draft.automated = false;
          await saveDraft(this.env, draft);
          return { draftId, title: draft.title };
        });
        await this.env.DRAFTS.put(jobKey, JSON.stringify({ jobId, status: 'completed', draftId: result.draftId, title: result.title, updatedAt: new Date().toISOString() }), { expirationTtl: 86400 });
        return { status: 'completed', draftId: result.draftId };
      } catch (error) {
        await this.env.DRAFTS.put(jobKey, JSON.stringify({ jobId, status: 'failed', title: idea.title, error: error.message || '記事の作成に失敗しました。', updatedAt: new Date().toISOString() }), { expirationTtl: 86400 });
        throw error;
      }
    }
    const dateKey = event.payload?.dateKey || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const retry = event.payload?.failure;
    const ideas = retry?.idea ? [retry.idea] : await step.do('find-10-article-ideas', async () => {
      try {
        const plan = await createDailyIdeas(this.env,dateKey);
        await this.env.DRAFTS.delete('fail:plan-'+dateKey);
        return plan;
      } catch(error) {
        await this.env.DRAFTS.put('fail:plan-'+dateKey,JSON.stringify({dateKey,title:'企画の調査',id:'plan-'+dateKey}));
        throw error;
      }
    });
    let completed = 0;
    for (const idea of ideas) {
      try {
        await step.do('write-'+idea.id,{retries:{limit:1,delay:'1 minute',backoff:'constant'}},async()=>{
          const key='draft:'+idea.createdAt+':'+idea.id;
          if(!await this.env.DRAFTS.get(key)){
            const draft=await createScheduledDraft(idea,this.env,dateKey);
            Object.assign(draft,{createdAt:idea.createdAt,rank:idea.index,reason:idea.reason,intent:idea.intent,deliverable:idea.deliverable,evidence:idea.sources?.[0]?.url});
            await saveDraft(this.env,draft);
          }
          await this.env.DRAFTS.delete('fail:'+idea.id);
          return true;
        });
        completed++;
      } catch {
        await step.do('record-'+idea.id,()=>this.env.DRAFTS.put('fail:'+idea.id,JSON.stringify({id:idea.id,title:idea.title,dateKey,idea}),{metadata:{title:idea.title.slice(0,90)}}).then(()=>true));
      }
    }
    if (retry?.id) await this.env.DRAFTS.delete('retry:' + retry.id);
    return { date: dateKey, created: completed };
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const dateKey = new Date(controller.scheduledTime + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    ctx.waitUntil(env.DAILY_DRAFTS.create({ id: `daily-${dateKey}`, params: { dateKey } }));
    ctx.waitUntil(threadsDailyTick(env));
  },
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/threads/callback' && request.method === 'GET') return finishThreadsConnect(request, env);
    if(pathname==='/api/threads/connect' && request.method==='GET') { const blocked=authorize(request,env); if(blocked) return blocked; return beginThreadsConnect(request,env); }
    if(pathname==='/api/threads/status' && request.method==='GET') { const blocked=authorize(request,env); if(blocked) return blocked; return getThreadsStatus(request,env); }
    if (pathname === '/api/cover' && ['GET','POST'].includes(request.method)) {
      const blocked = authorize(request, env, false); if (blocked) return blocked;
      return request.method === 'GET' ? getCoverImage(request, env) : regenerateCover(request, env);
    }
    if(pathname==='/api/weekly' && ['GET','PUT'].includes(request.method)) return weekly(request,env);
    if(pathname==='/api/failures'){
      const blocked=authorize(request,env); if(blocked) return blocked;
      if(request.method==='GET'){
        const page=await env.DRAFTS.list({prefix:'fail:',limit:100});
        return reply({items:page.keys.map(k=>({id:k.name.slice(5),title:k.metadata?.title||'企画の調査'}))});
      }
      if(request.method==='POST'){
        const {id}=await request.json();
        if(typeof id!=='string'||!id||id.length>200) return reply({error:'再作成する項目を確認してください'},400);
        const failure=await env.DRAFTS.get('fail:'+id,'json');
        if(!failure) return reply({error:'すでに処理済みです'},404);
        const retryKey='retry:'+id;
        if(await env.DRAFTS.get(retryKey)) return reply({ok:true,alreadyRunning:true},202);
        const runId='retry-'+crypto.randomUUID();
        await env.DRAFTS.put(retryKey,runId,{expirationTtl:900});
        try { await env.DAILY_DRAFTS.create({id:runId,params:{dateKey:failure.dateKey,failure}}); }
        catch(e){await env.DRAFTS.delete(retryKey);return reply({error:e.message||'再作成を開始できませんでした'},500);}
        return reply({ok:true,alreadyRunning:false},202);
      }
    }
    if (pathname === '/api/draft-jobs') {
      const blocked = authorize(request, env); if (blocked) return blocked;
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const idea = body.idea;
          const price = Number(body.price || 100);
          if (!idea || typeof idea.title !== 'string' || !idea.title.trim()) return reply({ error: '記事のアイデアを選んでください。' }, 400);
          if (![100, 300, 500, 980].includes(price)) return reply({ error: '記事の価格を選び直してください。' }, 400);
          if (!env.DAILY_DRAFTS || !env.DRAFTS) return reply({ error: '記事作成のバックグラウンド設定がありません。' }, 503);
          const jobId = crypto.randomUUID();
          const draftId = crypto.randomUUID();
          const dateKey = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const job = { jobId, status: 'queued', title: idea.title.slice(0, 200), createdAt: new Date().toISOString() };
          await env.DRAFTS.put('job:' + jobId, JSON.stringify(job), { expirationTtl: 86400 });
          try {
            await env.DAILY_DRAFTS.create({ id: 'manual-' + jobId, params: { manualDraft: { jobId, draftId, idea, ideaId: idea.id || null, price, dateKey } } });
          } catch (error) {
            await env.DRAFTS.put('job:' + jobId, JSON.stringify({ ...job, status: 'failed', error: error.message || '作成処理を開始できませんでした。' }), { expirationTtl: 86400 });
            throw error;
          }
          return reply({ jobId, status: 'queued' }, 202);
        } catch (error) {
          return reply({ error: error.message || '記事作成を開始できませんでした。' }, 500);
        }
      }
      if (request.method === 'GET') {
        const jobId = new URL(request.url).searchParams.get('id') || '';
        if (!/^[a-f0-9-]{36}$/i.test(jobId)) return reply({ error: '作成状況を確認できません。' }, 400);
        const job = await env.DRAFTS.get('job:' + jobId, 'json');
        return job ? reply(job) : reply({ error: '作成状況が見つかりません。下書き一覧を更新してください。' }, 404);
      }
      return reply({ error: 'この操作は利用できません。' }, 405);
    }
    if (pathname === '/api/status' && request.method === 'GET') return getStatus(request, env);
    if (pathname === '/api/ideas' && request.method === 'POST') return createIdeas(request, env);
    if (pathname === '/api/draft' && request.method === 'POST') return createDraft(request, env);
    if (pathname === '/api/drafts' && request.method === 'GET') return listDrafts(request, env);
    if (pathname === '/api/drafts' && request.method === 'PUT') return updateDraft(request, env);
    if (pathname === '/api/drafts' && request.method === 'DELETE') return removeDraft(request, env);
    if (pathname.startsWith('/api/')) return reply({ error: 'この操作は利用できません。' }, 404);
    return env.ASSETS.fetch(request);
  },
};
