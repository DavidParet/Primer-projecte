'use strict';

/**
 * Deployable only to Vercel PREVIEW with an explicit feature flag.
 * No production fallback. The Google client credentials are never returned
 * to the browser. The PostgreSQL role may execute only scoped RPC functions.
 */
const { Pool } = require('pg');
const { createVerifiedFamilyResolver } = require('./verified-family.cjs');
const { makeNeonIntentStore } = require('./neon-intent-store.cjs');
const { makePilotHandlers } = require('./pilot-handlers.cjs');
let runtimePromise;
function getRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise=(async()=>{
    if (process.env.VERCEL_ENV !== 'preview' || process.env.GMAIL_PILOT_ENABLED !== 'true') {
      throw new Error('gmail_pilot_disabled');
    }
    const required = [
      'GMAIL_PILOT_DATABASE_URL','NEON_AUTH_BASE_URL','NEON_AUTH_JWKS_URL',
      'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GMAIL_PILOT_LABEL_ID',
      'GMAIL_PILOT_COOKIE_KEY','GMAIL_PILOT_REDIRECT_URI'
    ];
    if (required.some(k=>!process.env[k])) throw new Error('gmail_pilot_unconfigured');
    const db=new Pool({
      connectionString:process.env.GMAIL_PILOT_DATABASE_URL,
      ssl:{rejectUnauthorized:true},
      max:2,connectionTimeoutMillis:4000,statement_timeout:5000,idleTimeoutMillis:1000
    });
    try {
      const role=await db.query(
        "SELECT current_user AS actor,has_schema_privilege(current_user,'nexlupa_worker_test','USAGE') AS raw_family_schema"
      );
      if (role.rows.length!==1 || role.rows[0].actor!=='nexlupa_gmail_auth_preview' ||
          role.rows[0].raw_family_schema!==false) throw new Error('privileged_db_role_rejected');
      const verifyFamily=await createVerifiedFamilyResolver({
        authBaseUrl:process.env.NEON_AUTH_BASE_URL,
        jwksUrl:process.env.NEON_AUTH_JWKS_URL,
        pgQuery:(text,args)=>db.query(text,args)
      });
      return makePilotHandlers({
        verifyFamily,
        pgQuery:(text,args)=>db.query(text,args),
        createIntentStore:makeNeonIntentStore,
        settings:{
          enabled:true,
          clientId:process.env.GOOGLE_CLIENT_ID,
          clientSecret:process.env.GOOGLE_CLIENT_SECRET,
          redirectUri:process.env.GMAIL_PILOT_REDIRECT_URI,
          cookieKey:process.env.GMAIL_PILOT_COOKIE_KEY,
          pilotLabelId:process.env.GMAIL_PILOT_LABEL_ID
        }
      });
    } catch(e) { await db.end();throw e; }
  })().catch(e=>{runtimePromise=null;throw e;});
  return runtimePromise;
}
module.exports={getRuntime};
