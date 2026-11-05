import { WorkflowEntrypoint } from 'cloudflare:workers';
import {
  authorize, weekly, createDailyIdeas, createDraft, createIdeas, createScheduledDraft, getStatus,
  listDrafts, removeDraft, reply, saveDraft, updateDraft,
} from './functions/_lib.js';

export class DailyDraftWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
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
    return { date: dateKey, created: completed };
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const dateKey = new Date(controller.scheduledTime + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    ctx.waitUntil(env.DAILY_DRAFTS.create({ id: `daily-${dateKey}`, params: { dateKey } }));
  },
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if(pathname==='/api/weekly' && ['GET','PUT'].includes(request.method)) return weekly(request,env);
    if(pathname==='/api/failures'){
      const blocked=authorize(request,env); if(blocked) return blocked;
      if(request.method==='GET'){
        const page=await env.DRAFTS.list({prefix:'fail:',limit:100});
        return reply({items:page.keys.map(k=>({id:k.name.slice(5),title:k.metadata?.title||'企画の調査'}))});
      }
      if(request.method==='POST'){
        const {id}=await request.json();
        const failure=await env.DRAFTS.get('fail:'+id,'json');
        if(!failure) return reply({error:'すでに処理済みです'},404);
        const runId='retry-'+id+'-'+Math.floor(Date.now()/60000);
        try { await env.DAILY_DRAFTS.create({id:runId,params:{dateKey:failure.dateKey,failure}}); }
        catch(e){if(!/already exists/i.test(String(e))) throw e;}
        return reply({ok:true},202);
      }
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
