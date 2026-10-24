import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPagesConnection} from '../scripts/prepare-pages-connection.mjs';

test('static sign-in config includes only public credentials and the intended backend', () => {
  const input = {supabaseUrl:'https://project.supabase.co/',supabaseKey:'sb_publishable_public123',secret:'never'};
  assert.deepEqual(publicPagesConnection('https://api.test',input), {
    backend:'https://api.test',supabaseUrl:'https://project.supabase.co',supabaseKey:'sb_publishable_public123',
  });
  const jwt = role => `e30.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
  assert.equal(publicPagesConnection('https://api.test',{...input,supabaseKey:jwt('anon')}).supabaseKey,jwt('anon'));
  for (const key of ['sb_secret_private',jwt('service_role'),'garbage']) {
    assert.throws(() => publicPagesConnection('https://api.test',{...input,supabaseKey:key}),/Only a public/);
  }
  for (const backend of ['http://api.test','https://api.test/path','https://user:pass@api.test']) {
    assert.throws(() => publicPagesConnection(backend,input));
  }
  for (const supabaseUrl of ['http://project.test','https://user:pass@project.test','https://project.test/path']) {
    assert.throws(() => publicPagesConnection('https://api.test',{...input,supabaseUrl}));
  }
});

test('local unauthenticated development config can never be published for a remote backend', () => {
  assert.deepEqual(publicPagesConnection('http://localhost:3018',{local:true}),{backend:'http://localhost:3018',local:true});
  assert.throws(() => publicPagesConnection('https://api.test',{local:true}));
});
