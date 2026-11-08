'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHmac } = require('node:crypto');
const handler = require('../api/whatsapp-webhook');
const {
  MAX_BODY_BYTES, BodyTooLargeError, readRawBody, verifyToken, verifyMetaSignature
} = require('../lib/whatsapp/webhook-security');

const ORIGINAL_ENV = {
  mode: process.env.WHATSAPP_WEBHOOK_MODE,
  token: process.env.WHATSAPP_VERIFY_TOKEN,
  secret: process.env.WHATSAPP_APP_SECRET
};
test.after(() => {
  for (const [key, env] of [
    ['WHATSAPP_WEBHOOK_MODE', ORIGINAL_ENV.mode],
    ['WHATSAPP_VERIFY_TOKEN', ORIGINAL_ENV.token],
    ['WHATSAPP_APP_SECRET', ORIGINAL_ENV.secret]
  ]) {
    if (env === undefined) delete process.env[key]; else process.env[key] = env;
  }
});

function configured() {
  process.env.WHATSAPP_WEBHOOK_MODE = 'verify-only';
  process.env.WHATSAPP_VERIFY_TOKEN = 'my-unique-verify-token';
  process.env.WHATSAPP_APP_SECRET = 'my-application-secret';
}

function signed(body, secret = 'my-application-secret') {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

async function invoke({ method='GET', query, url='/', headers={}, body='' }={}) {
  const req = Readable.from([Buffer.from(body, 'utf8')]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (query) req.query = query;
  const res = {
    code: 200, headers: {}, body: null,
    status(code) { this.code = code; return this; },
    json(data) { this.body = data; return this; },
    send(data) { this.body = data; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  };
  await handler(req, res);
  return res;
}

test('Mode desactivat per defecte: mai rep un xat', async () => {
  delete process.env.WHATSAPP_WEBHOOK_MODE;
  assert.equal((await invoke()).code, 503);
  assert.equal((await invoke({method:'POST'})).code, 503);
});

test('GET: retorna exactament el challenge amb token correcte', async () => {
  configured();
  const result = await invoke({query:{
    'hub.mode':'subscribe','hub.verify_token':'my-unique-verify-token','hub.challenge':'789123'
  }});
  assert.equal(result.code, 200);
  assert.equal(result.body, '789123');
  assert.match(result.headers['content-type'], /^text\/plain/);
});

test('GET: també funciona amb els paràmetres de la URL', async () => {
  configured();
  const result = await invoke({url:'/?hub.mode=subscribe&hub.verify_token=my-unique-verify-token&hub.challenge=177'});
  assert.equal(result.code, 200);
  assert.equal(result.body, '177');
});

test('GET: denega token erroni i mode erroni', async () => {
  configured();
  const query={ 'hub.mode':'subscribe','hub.verify_token':'wrong','hub.challenge':'1' };
  assert.equal((await invoke({query})).code, 403);
  assert.equal((await invoke({query:{...query,'hub.mode':'fetch'}})).code, 403);
  assert.equal(verifyToken('wrong','my-unique-verify-token'), false);
});

test('GET: no accepta challenge amb salts de línia ni falta de secret', async () => {
  configured();
  const query={ 'hub.mode':'subscribe','hub.verify_token':'my-unique-verify-token','hub.challenge':'ok\nnot-ok' };
  assert.equal((await invoke({query})).code, 400);
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.equal((await invoke({query})).code, 503);
});

test('POST: exigeix secret d’aplicació i tipus JSON', async () => {
  configured();
  delete process.env.WHATSAPP_APP_SECRET;
  assert.equal((await invoke({method:'POST',headers:{'content-type':'application/json'}})).code, 503);
  configured();
  assert.equal((await invoke({method:'POST',headers:{'content-type':'text/plain'}})).code, 415);
});

test('POST: verifica signatura HMAC-SHA256 de bytes sense reserialitzar', async () => {
  configured();
  const body='{\n  "object":"whatsapp_business_account", "entry":[]\n}';
  const good=signed(body);
  const req={method:'POST',body,headers:{
    'content-type':'application/json; charset=utf-8','x-hub-signature-256':good
  }};
  assert.equal(verifyMetaSignature(Buffer.from(body),good,'my-application-secret'),true);
  assert.equal(verifyMetaSignature(Buffer.from(body),good,'wrong'),false);
  assert.equal((await invoke(req)).code, 503); // signature valid, no storage => NOT acknowledged
  assert.equal((await invoke({...req,body:body.replace('entry','entries')})).code, 403);
  assert.equal((await invoke({...req,headers:{...req.headers,'x-hub-signature-256':'sha256=broken'}})).code, 403);
});

test('POST: requereix signatura, encara que el contingut sigui JSON vàlid', async () => {
  configured();
  assert.equal((await invoke({method:'POST',body:'{}',headers:{'content-type':'application/json'}})).code, 403);
});

test('POST: rebutja JSON invàlid fins i tot si està signat correctament', async () => {
  configured();
  const body='{"not":"valid"';
  const result=await invoke({method:'POST',body,headers:{'content-type':'application/json','x-hub-signature-256':signed(body)}});
  assert.equal(result.code, 400);
});

test('POST: rebutja un objecte aliè a WhatsApp, encara que signat', async () => {
  configured();
  const body='{"object":"page","entry":[]}';
  const result=await invoke({method:'POST',body,headers:{'content-type':'application/json','x-hub-signature-256':signed(body)}});
  assert.equal(result.code, 400);
});

test('POST: payload massa gran es denega abans de processar', async () => {
  configured();
  const body='x'.repeat(MAX_BODY_BYTES+1);
  const result=await invoke({method:'POST',body,headers:{'content-type':'application/json'}});
  assert.equal(result.code, 413);
  await assert.rejects(readRawBody(Readable.from([Buffer.alloc(MAX_BODY_BYTES+1)])),BodyTooLargeError);
});

test('Cap mètode inesperat; headers de seguretat i resposta sense contingut personal', async () => {
  configured();
  const result=await invoke({method:'PUT'});
  assert.equal(result.code, 405);
  assert.equal(result.headers['allow'],'GET, POST');
  assert.equal(result.headers['cache-control'],'no-store');
  assert.equal(result.headers['x-content-type-options'],'nosniff');
});

test('POST signat mai no retorna HTTP 2xx sense cua duradora implementada', async () => {
  configured();
  const body=JSON.stringify({
    object:'whatsapp_business_account',
    entry:[{id:'synthetic-id',changes:[{field:'messages',value:{
      messages:[{id:'synthetic-message',text:{body:'Missatge fictici'}}]
    }}]}]
  });
  const r=await invoke({method:'POST',body,headers:{
    'content-type':'application/json','x-hub-signature-256':signed(body)
  }});
  assert.equal(r.code,503);
  assert.equal(JSON.stringify(r.body).includes('Missatge fictici'),false);
  assert.equal(r.headers['retry-after'],'60');
});
