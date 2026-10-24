import fs from 'node:fs/promises';

// This is the same public configuration returned to every signed-out browser.
// Keep credentials with server privileges out of the static deployment.
export function publicPagesConnection(backend, input) {
  const origin = new URL(backend);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.origin !== backend || origin.username || origin.password ||
      !(origin.protocol === 'https:' || local && origin.protocol === 'http:')) {
    throw Error('The Pages backend must be a secure origin.');
  }
  if (local && input?.local === true) return {backend, local: true};
  const url = new URL(input?.supabaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Error('The public sign-in URL must be an HTTPS origin.');
  }
  const key = input?.supabaseKey;
  let isPublic = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (typeof key === 'string' && !isPublic) {
    try { isPublic = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; }
    catch { /* Reject malformed or private keys. */ }
  }
  if (!isPublic || key.length > 4096) throw Error('Only a public Supabase publishable or anon key may be deployed.');
  return {backend, supabaseUrl: url.origin, supabaseKey: key};
}

export async function preparePagesConnection(backend, output = 'frontend/public/engine-connection.json') {
  const response = await fetch(`${backend}/api/engine/config`, {
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Public workspace configuration is unavailable (${response.status}).`);
  const config = publicPagesConnection(backend, await response.json());
  await fs.writeFile(output, JSON.stringify(config) + '\n');
}
