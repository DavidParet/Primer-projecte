'use strict';

/**
 * Isolated server handlers for the manually initiated Gmail pilot.
 * No timers, background scans, mail mutations, database card writes, or AI.
 */
const { beginPilotOAuth, completePilotOAuth } = require('./oauth-flow.cjs');
const { previewLabeledMail } = require('./preview-import.cjs');
const { newBrowserNonce, makeCookie, readCookie, clearCookie } = require('./cookie-session.cjs');
const { createHash } = require('node:crypto');
const URI_RE = /^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9/_-]*)?$/;
const LABEL_RE = /^Label_[A-Za-z0-9_-]{1,80}$/;
const CLEAN_URL_SCRIPT = "history.replaceState(null, '', '/api/gmail/callback');";
const SCRIPT_HASH = createHash('sha256').update(CLEAN_URL_SCRIPT).digest('base64');
function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}
function setSafeHeaders(res, type='json') {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  if (type==='html') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
      "form-action 'none'; script-src 'sha256-"+SCRIPT_HASH+"'; style-src 'unsafe-inline'");
  } else {
    res.setHeader('Content-Type','application/json; charset=utf-8');
  }
}
function htmlPage({heading, intro, details}) {
  const entries = Array.isArray(details) ? details.slice(0,3) : [];
  const cards = entries.map(d => '<li><strong>'+htmlEscape(d.title)+'</strong>' +
    '<p>Origen: '+htmlEscape(d.from)+'</p><p>'+htmlEscape(d.bodyExcerpt)+'</p></li>').join('');
  return '<!doctype html><html lang="ca"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>NexLupa — Gmail pilot</title></head><body>' +
    '<main style="max-width:640px;margin:40px auto;font:16px system-ui;padding:16px">' +
    '<h1>'+htmlEscape(heading)+'</h1><p>'+htmlEscape(intro)+'</p>' +
    (cards ? '<ol>'+cards+'</ol>' : '') +
    '<p><small>Previsualització de prova. No s’ha enviat ni modificat cap missatge.</small></p>' +
    '</main><script>'+CLEAN_URL_SCRIPT+'</script></body></html>';
}
function requiredSettings(settings) {
  if (settings?.enabled !== true) throw new Error('gmail_pilot_disabled');
  if (typeof settings.clientId!=='string' || !settings.clientId ||
      typeof settings.clientSecret!=='string' || !settings.clientSecret ||
      !URI_RE.test(settings.redirectUri || '') ||
      typeof settings.cookieKey!=='string' || !LABEL_RE.test(settings.pilotLabelId || '')) {
    throw new Error('gmail_pilot_not_configured');
  }
  const u = new URL(settings.redirectUri);
  if (u.pathname !== '/api/gmail/callback' || u.search || u.hash || u.username || u.password) {
    throw new Error('gmail_pilot_redirect_mismatch');
  }
  return {origin:u.origin};
}
function makePilotHandlers({ verifyFamily, pgQuery, createIntentStore, settings, fetchImpl=fetch, clock=Date.now }) {
  if (typeof verifyFamily!=='function' || typeof pgQuery!=='function' ||
      typeof createIntentStore!=='function') throw new Error('server_dependencies_required');
  const intents = createIntentStore(pgQuery);
  if (typeof intents?.saveIntent!=='function' || typeof intents?.takeIntent!=='function')
    throw new Error('atomic_intent_store_required');
  async function consent(identity) {
    if (!identity?.authUserId || !identity?.familyId) return false;
    const db=await pgQuery(
      'SELECT nexlupa_worker_rpc.is_verified_gmail_family($1::uuid,$2::uuid) AS allowed',
      [identity.authUserId,identity.familyId]
    );
    return db?.rows?.length===1 && db.rows[0].allowed===true;
  }
  async function start(req,res) {
    setSafeHeaders(res);
    if (req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
    let origin;
    try { origin=requiredSettings(settings).origin; }
    catch { return res.status(503).json({error:'pilot_not_available'}); }
    // Authorization header is mandatory, with same-origin Origin guard as defense in depth.
    if (req.headers?.origin!==origin || !/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||'')) {
      return res.status(403).json({error:'request_origin_rejected'});
    }
    const len=Number(req.headers?.['content-length']||0);
    if (!Number.isSafeInteger(len) || len>512 || !req.body || Array.isArray(req.body) ||
        typeof req.body!=='object' || typeof req.body.familyId!=='string') {
      return res.status(400).json({error:'invalid_request'});
    }
    try {
      const authorized=await verifyFamily({
        authorization:req.headers.authorization, requestedFamilyId:req.body.familyId
      });
      const nonce=newBrowserNonce();
      const familySession={...authorized, sessionId:nonce};
      // DB checks membership+consent now and when saving the state.
      const result=await beginPilotOAuth({
        familySession, clientId:settings.clientId, redirectUri:settings.redirectUri,
        hasCurrentConsent:()=>consent(authorized),
        saveIntent:intents.saveIntent, clock
      });
      const state=new URL(result.authorizationUrl).searchParams.get('state');
      res.setHeader('Set-Cookie',makeCookie({
        key:settings.cookieKey, familyId:authorized.familyId, authUserId:authorized.authUserId,
        nonce,state,clock
      }));
      return res.status(200).json({
        ready:true, authorizationUrl:result.authorizationUrl,
        expiresInSeconds:result.expiresInSeconds, scope:'gmail.readonly',
        noBackgroundAccess:true
      });
    } catch (e) {
      const status=['family_auth_required','authentication_required'].includes(e.message)?401:
        ['family_not_authorized','gmail_consent_required'].includes(e.message)?403:503;
      return res.status(status).json({ready:false,error:status===503?'pilot_not_ready':e.message});
    }
  }
  async function callback(req,res) {
    setSafeHeaders(res,'html');
    res.setHeader('Set-Cookie',clearCookie()); // expire binding on every callback
    if (req.method!=='GET') return res.status(405).send(htmlPage({
      heading:'Sol·licitud no admesa',intro:'Cal iniciar la connexió des de NexLupa.'
    }));
    try { requiredSettings(settings); }
    catch { return res.status(503).send(htmlPage({
      heading:'Prova no disponible',intro:'La connexió de Gmail no està activada.'
    })); }
    try {
      const query=req.query||{};
      const binding=readCookie({
        key:settings.cookieKey,
        header:req.headers?.cookie,
        returnedState:query.state,
        clock
      });
      const familySession={
        kind:'family-session',verifiedByServer:true,
        familyId:binding.familyId,authUserId:binding.authUserId,sessionId:binding.nonce
      };
      let preview=null;
      const result=await completePilotOAuth({
        familySession,
        callback:{state:query.state,code:query.code,error:query.error},
        clientId:settings.clientId,clientSecret:settings.clientSecret,
        redirectUri:settings.redirectUri,
        takeIntent:intents.takeIntent,
        hasCurrentConsent:()=>consent(binding),
        onAuthorized:async({googleAccount,accessToken})=>{
          preview=await previewLabeledMail({
            familySession,googleAccount,accessToken,
            pilotLabelId:settings.pilotLabelId,maxResults:3,
            checkCurrentFamilyConsent:()=>consent(binding),
            fetchImpl
          });
        },
        fetchImpl,clock
      });
      if (result.status!=='authorized_for_single_pilot_action' || !preview) {
        throw new Error('pilot_incomplete');
      }
      return res.status(200).send(htmlPage({
        heading:'Correus preparats per revisar',
        intro:'S’han llegit '+preview.reviewedMessages+' missatges de l’etiqueta pilot. No s’han analitzat amb IA ni desat.',
        details:preview.drafts
      }));
    } catch {
      return res.status(400).send(htmlPage({
        heading:'No s’ha completat la connexió',
        intro:'L’autorització ha caducat, s’ha denegat o no s’han pogut verificar els permisos. Inicia-la de nou des de NexLupa.'
      }));
    }
  }
  return {start,callback};
}
module.exports={makePilotHandlers, htmlEscape};
