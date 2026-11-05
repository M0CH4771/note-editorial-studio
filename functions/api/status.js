import { getStatus } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  return getStatus(request, env);
}
