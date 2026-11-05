import { createDraft, createIdeas, getStatus, reply } from './functions/_lib.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/status' && request.method === 'GET') return getStatus(request, env);
    if (pathname === '/api/ideas' && request.method === 'POST') return createIdeas(request, env);
    if (pathname === '/api/draft' && request.method === 'POST') return createDraft(request, env);
    if (pathname.startsWith('/api/')) return reply({ error: 'この操作は利用できません。' }, 404);
    return env.ASSETS.fetch(request);
  },
};
