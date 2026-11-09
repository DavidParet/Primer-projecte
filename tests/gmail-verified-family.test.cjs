'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { createVerifiedFamilyResolver, verifyConfig, bearerToken } =
  require('../lib/gmail/verified-family.cjs');
const familyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const authBaseUrl = 'https://ep-test.neonauth.c-7.eu-central-1.aws.neon.tech/nexlupa_pilot/auth';
const jwksUrl = authBaseUrl + '/.well-known/jwks.json';
let signer, keys, SignJWT, exportJWK, createLocalJWKSet, calls = [];
test.before(async () => {
  ({ SignJWT, exportJWK, createLocalJWKSet } = await import('jose'));
  const pair = generateKeyPairSync('ed25519');
  signer = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...jwk, alg: 'EdDSA', use: 'sig', kid: 'test-ed' }] });
});
const now = () => Math.floor(Date.now()/1000);
async function makeToken({
  issuer = new URL(authBaseUrl).origin,
  subject = userId,
  role = 'authenticated',
  issued = now(),
  expiry = now() + 900
} = {}) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg:'EdDSA', kid:'test-ed' })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt(issued)
    .setExpirationTime(expiry)
    .sign(signer);
}
async function makeResolver({ allowed = true, db } = {}) {
  calls = [];
  return createVerifiedFamilyResolver({
    authBaseUrl, jwksUrl, keySet: keys,
    pgQuery: db || (async (sql, args) => {
      calls.push({ sql, args });
      return { rows: [{ allowed }] };
    })
  });
}
test('rejects unrelated or insecure JWKS configuration', () => {
  assert.throws(() => verifyConfig({ authBaseUrl, jwksUrl:'https://evil.example/jwks.json' }), /neon_auth_configuration_invalid/);
  assert.throws(() => verifyConfig({ authBaseUrl: 'http://ep-test.neon.tech', jwksUrl }), /neon_auth_configuration_invalid/);
});
test('requires one well-formed Authorization bearer JWT', () => {
  for (const x of ['', 'Basic abc', 'Bearer abc', 'Bearer a.b.c\n', 'Bearer a.b.c, Bearer x.y.z']) {
    assert.throws(() => bearerToken(x), /authentication_required/);
  }
});
test('verified EdDSA token and DB membership yields server-only familySession', async () => {
  const verifyFamily = await makeResolver();
  const token = await makeToken();
  const result = await verifyFamily({ authorization:'Bearer '+token, requestedFamilyId: familyId });
  assert.deepEqual({ kind:result.kind, verifiedByServer:result.verifiedByServer, familyId:result.familyId },
    { kind:'family-session', verifiedByServer:true, familyId });
  assert.match(result.sessionId, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.deepEqual(calls[0].args, [userId, familyId]);
  assert.match(calls[0].sql, /is_verified_gmail_family/);
});
test('wrong issuer is not authorized even with a valid signature', async () => {
  const verifyFamily = await makeResolver();
  await assert.rejects(verifyFamily({ authorization:'Bearer '+await makeToken({ issuer:'https://evil.example' }), requestedFamilyId:familyId }), /authentication_required/);
  assert.equal(calls.length, 0);
});
test('a tampered token is rejected cryptographically', async () => {
  const verifyFamily = await makeResolver();
  const jwt = await makeToken();
  const pieces = jwt.split('.');
  const changed = (pieces[1][0] === 'a' ? 'b' : 'a')+pieces[1].slice(1);
  await assert.rejects(verifyFamily({ authorization:'Bearer '+[pieces[0],changed,pieces[2]].join('.'),requestedFamilyId:familyId }), /authentication_required/);
  assert.equal(calls.length,0);
});
test('expired JWT cannot initiate an OAuth flow', async () => {
  const verifyFamily = await makeResolver();
  await assert.rejects(verifyFamily({ authorization:'Bearer '+await makeToken({ issued:now()-500,expiry:now()-300 }), requestedFamilyId:familyId }), /authentication_required/);
});
test('only normal authenticated Neon users can request Gmail linkage', async () => {
  const verifyFamily = await makeResolver();
  await assert.rejects(verifyFamily({ authorization:'Bearer '+await makeToken({ role:'anonymous' }),requestedFamilyId:familyId }), /authentication_required/);
});
test('unknown family membership or unverified user fails closed', async () => {
  const verifyFamily = await makeResolver({ allowed:false });
  await assert.rejects(verifyFamily({ authorization:'Bearer '+await makeToken(),requestedFamilyId:familyId }), /family_not_authorized/);
});
test('invalid family selector is rejected before DB query', async () => {
  const verifyFamily = await makeResolver();
  await assert.rejects(verifyFamily({ authorization:'Bearer '+await makeToken(),requestedFamilyId:'other family' }), /invalid_family_selection/);
  assert.equal(calls.length,0);
});
test('database failures never grant a family session', async () => {
  const verifyFamily = await makeResolver({ db:async()=>{throw Error('database_offline')} });
  await assert.rejects(verifyFamily({ authorization:'Bearer '+await makeToken(),requestedFamilyId:familyId }), /database_offline/);
});
