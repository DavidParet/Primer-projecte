'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');
const freeUsage = require('../lib/free-usage');
const { createPilotAuthHandler, encodePilotSession } = require('../lib/pilot-auth-bff');

const origin = 'https://nexlupa-quota-proves.vercel.app';
const authBase = 'https://ep-nexlupa.neonauth.eu-central-1.aws.neon.tech/nexlupa_pilot/auth';
const env = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feat/free-quota-server-pilot',
  NEXLUPA_AUTH_PILOT: 'enabled',
  NEXLUPA_AUTH_PILOT_ORIGIN: origin,
  NEXLUPA_AUTH_BASE_URL: authBase,
  NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS: 'nexlupa-alpha,nexlupa-bravo',
};

function token(suffix) {
  return 'fictici-pilot-cookie-' + suffix;
}

async function fetchIdentity(url, options) {
  assert.equal(url, authBase + '/get-session?disableCookieCache=true');
  const value = options.headers.Cookie.split('=')[1];
  const subject = {
    [token('primera')]: 'nexlupa-alpha',
    [token('segona')]: 'nexlupa-alpha',
    [token('bravo')]: 'nexlupa-bravo',
    [token('fora')]: 'nexlupa-exclos',
  }[value];
  if (!subject) return new Response('{}', { status: 401 });
  return Response.json({
    user: { id: subject },
    session: { userId: subject, id: value,
      createdAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString() },
  });
}

function request({ method = 'POST', session, body = { text: 'Demà hi ha reunió a les 17 h.' }, query = {},
  from = origin } = {}) {
  return {
    method, body, query,
    headers: {
      'content-type': 'application/json',
      host: new URL(origin).host,
      origin: from,
      ...(session && { cookie: '__Host-nexlupa_pilot=' + encodePilotSession('better-auth.session_token=' + session) }),
    },
  };
}

async function call(handler, req) {
  const headers = {};
  let status = 200;
  let body;
  await handler(req, {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  });
  return { status, body, headers };
}

function loadAnalyze(checkQuota, modelCalls) {
  const original = Module._load;
  const modulePath = require.resolve('../api/analyze');
  delete require.cache[modulePath];
  Module._load = function (name, ...args) {
    if (name === '../lib/free-usage') {
      return { isFreeUsagePilot: () => freeUsage.isFreeUsagePilot(env), checkFreeUsage: checkQuota };
    }
    if (name === 'openai') {
      return function OpenAI() {
        return { chat: { completions: { create: async input => {
          modelCalls.push(input);
          return { choices: [{ message: { content: JSON.stringify({
            resum: 'Reunió', accions: [], recordatoris: [], esdeveniments: [],
          }) } }] };
        } } } };
      };
    }
    return original.call(this, name, ...args);
  };
  try { return require(modulePath); } finally { Module._load = original; }
}

test('El pilot FREE exigeix sessió abans de reservar quota o cridar el model', async () => {
  const modelCalls = [];
  const db = { query: async () => { throw new Error('no s’ha de consultar la base de dades'); } };
  const analyze = loadAnalyze((req, opts) =>
    freeUsage.checkFreeUsage(req, { ...opts, env, fetchImpl: fetchIdentity, db }), modelCalls);
  const unsigned = await call(analyze, request({ body: { text: 'Avís', subject: 'nexlupa-alpha' } }));
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.body.usage.code, 'SIGN_IN_REQUIRED');
  const outside = await call(analyze, request({ session: token('fora') }));
  assert.equal(outside.status, 401);
  const foreignOrigin = await call(analyze, request({ session: token('primera'), from: 'https://fora.example' }));
  assert.equal(foreignOrigin.status, 403);
  assert.equal(modelCalls.length, 0);
});

test('El quart intent del mateix compte rep 429 quan canvia la sessió; un altre compte conserva la seva quota', async () => {
  const modelCalls = [];
  const count = new Map();
  const db = { async query(sql, params) {
    const [issuer, subject, limit] = params;
    assert.equal(issuer, authBase);
    const used = count.get(subject) ?? 0;
    if (!sql.startsWith('INSERT')) return { rows: used ? [{ used }] : [] };
    assert.equal(limit, 3);
    if (used >= limit) return { rows: [] };
    count.set(subject, used + 1);
    return { rows: [{ used: used + 1 }] };
  } };
  const analyze = loadAnalyze((req, opts) =>
    freeUsage.checkFreeUsage(req, { ...opts, env, fetchImpl: fetchIdentity, db }), modelCalls);

  const status = await call(analyze, request({ method: 'GET', session: token('primera'), query: { freeUsage: '1' } }));
  assert.equal(status.body.used, 0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await call(analyze, request({ session: token('primera') }));
    assert.equal(res.status, 200);
    assert.equal(res.body.usage.used, attempt);
  }

  const limited = await call(analyze, request({ session: token('segona') }));
  assert.equal(limited.status, 429);
  assert.equal(limited.body.usage.used, 3);
  assert.equal(limited.body.code, 'FREE_DAILY_LIMIT');
  assert.equal(modelCalls.length, 3);

  const other = await call(analyze, request({ session: token('bravo') }));
  assert.equal(other.status, 200);
  assert.equal(other.body.usage.used, 1);
  assert.equal(modelCalls.length, 4);
});

test('Un error de la base de dades tanca el pas a la IA', async () => {
  const modelCalls = [];
  const analyze = loadAnalyze((req, opts) =>
    freeUsage.checkFreeUsage(req, { ...opts, env, fetchImpl: fetchIdentity,
      db: { query: async () => { throw new Error('base de dades no disponible'); } } }), modelCalls);
  const res = await call(analyze, request({ session: token('primera') }));
  assert.equal(res.status, 503);
  assert.equal(res.body.usage.code, 'QUOTA_UNAVAILABLE');
  assert.equal(modelCalls.length, 0);
});

test('L’autenticació pilot conserva la galeta HttpOnly del mateix domini', async () => {
  const login = createPilotAuthHandler({ env, fetchImpl: async (url, options) => {
    if (url.endsWith('/sign-in/email')) {
      assert.equal(options.headers.Origin, origin);
      return new Response('{}', { headers: { 'Set-Cookie': 'better-auth.session_token=' + token('primera') } });
    }
    return fetchIdentity(url, options);
  } });
  const result = await call(login, request({ body: {
    action: 'sign_in', email: 'pilot@example.test', password: 'ficticia-llarga',
  } }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { state: 'authenticated' });
  assert.match(result.headers['set-cookie'], /__Host-nexlupa_pilot=.*; Path=\/; Secure; HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(result.headers['set-cookie'], /Domain=/i);
});

test('La quota és exclusiva de la branca pilot i de Vercel Preview', () => {
  assert.equal(freeUsage.isFreeUsagePilot(env), true);
  assert.equal(freeUsage.isFreeUsagePilot({ ...env, VERCEL_ENV: 'production' }), false);
  assert.equal(freeUsage.isFreeUsagePilot({ ...env, VERCEL_GIT_COMMIT_REF: 'ui-2.0' }), false);
});
