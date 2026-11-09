'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const { COOKIE_NAME, TTL_MS, newBrowserNonce, makeCookie, readCookie, clearCookie } =
  require('../lib/gmail/cookie-session.cjs');

const key=randomBytes(32).toString('base64url');
const familyId='10000000-0000-4000-8000-000000000001';
const authUserId='20000000-0000-4000-8000-000000000001';
const state=randomBytes(32).toString('base64url');
const nonce=newBrowserNonce();
const initial=1_000_000;
function issued(overrides={}) {
  return makeCookie({key,familyId,authUserId,state,nonce,clock:()=>initial,...overrides});
}
function open(c,overrides={}) {
  return readCookie({key,header:c.split(';')[0],returnedState:state,clock:()=>initial+1000,...overrides});
}
test('cookie is secure, HttpOnly, SameSite Lax, short-lived and host-only',()=>{
  const c=issued();
  assert.ok(c.startsWith(COOKIE_NAME+'='));
  for(const x of ['Path=/','Secure','HttpOnly','SameSite=Lax','Max-Age=240'])assert.ok(c.includes(x));
  assert.ok(!c.includes('Domain='));
  assert.equal(TTL_MS,240000);
  assert.ok(!c.includes(familyId));
  assert.ok(!c.includes(authUserId));
  assert.ok(!c.includes(nonce));
});
test('encrypted cookie binds family, auth subject, nonce and state',()=>{
  const value=open(issued());
  assert.deepEqual(value,{familyId,authUserId,nonce,state});
});
test('fresh random nonce is not reused across starts',()=>{
  assert.notEqual(newBrowserNonce(),newBrowserNonce());
  assert.match(newBrowserNonce(),/^[A-Za-z0-9_-]{43}$/);
});
test('cannot read a cookie with a different key',()=>{
  const other=randomBytes(32).toString('base64url');
  assert.throws(()=>open(issued(),{key:other}),/oauth_cookie_invalid/);
});
test('wrong OAuth state is rejected',()=>{
  assert.throws(()=>open(issued(),{returnedState:randomBytes(32).toString('base64url')}),/oauth_cookie_invalid/);
});
test('tampering with cookie ciphertext fails authenticated decryption',()=>{
  const c=issued();
  const start=c.indexOf('=')+1;
  const raw=c.slice(start).split(';')[0];
  const p=raw.split('.');
  const replaced=(p[1][3]==='A'?'B':'A');
  p[1]=p[1].slice(0,3)+replaced+p[1].slice(4);
  const altered=COOKIE_NAME+'='+p.join('.');
  assert.throws(()=>open(altered),/oauth_cookie_invalid/);
});
test('expired binding cannot be reused',()=>{
  assert.throws(()=>open(issued(),{clock:()=>initial+TTL_MS+1}),/oauth_cookie_invalid/);
});
test('rejects duplicate cookie headers and missing cookie',()=>{
  const raw=issued().split(';')[0];
  assert.throws(()=>readCookie({key,header:raw+'; '+raw,returnedState:state,clock:()=>initial+10}),/oauth_cookie_missing/);
  assert.throws(()=>readCookie({key,header:'some=other',returnedState:state}),/oauth_cookie_missing/);
});
test('invalid encryption key blocks issuance',()=>{
  assert.throws(()=>issued({key:'too-short'}),/invalid_pilot_cookie_key/);
});
test('invalid family or state cannot produce an OAuth binding',()=>{
  assert.throws(()=>issued({familyId:'unsafe'}),/invalid_oauth_cookie_data/);
  assert.throws(()=>issued({state:'unsafe'}),/invalid_oauth_cookie_data/);
});
test('clearing cookie removes it at browser root',()=>{
  const c=clearCookie();
  assert.ok(c.startsWith(COOKIE_NAME+'=;'));
  assert.ok(c.includes('Max-Age=0'));
  assert.ok(c.includes('Secure'));
});
