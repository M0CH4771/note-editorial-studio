import { createDraft } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  return createDraft(request, env);
}
