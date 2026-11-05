import { createIdeas } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  return createIdeas(request, env);
}
