import { WorkflowEntrypoint } from 'cloudflare:workers';
import {
  createDailyIdeas, createDraft, createIdeas, createScheduledDraft, getStatus,
  listDrafts, removeDraft, reply, saveDraft, updateDraft,
} from './functions/_lib.js';

export class DailyDraftWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const dateKey = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ideas = await step.do('find-10-article-ideas', () => createDailyIdeas(this.env, dateKey));
    let completed = 0;

    for (const [index, idea] of ideas.entries()) {
      await step.do(`write-and-save-draft-${index + 1}`, async () => {
        const draft = await createScheduledDraft(idea, this.env, dateKey);
        await saveDraft(this.env, draft);
        return { id: draft.id, title: draft.title };
      });
      completed++;
    }
    return { date: dateKey, created: completed };
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
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
