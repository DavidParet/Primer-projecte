'use strict';
/**
 * Server-only runtime wiring for the separate Resend forwarding pilot.
 * All credentials come exclusively from branch-scoped Vercel env vars.
 * Never output a connection string, webhook secret or encryption key.
 */
const {createNeonReceiptAdapters}=require('./neon-receipt.cjs');
const {makeHttpHandler,ALLOWED_BRANCH}=require('./http-handler.cjs');

const URL_HOST=/^[a-z0-9.-]+\.neon\.tech$/;
function validateConnectionString(value){
  if(typeof value!=='string'||value.length<50||value.length>4096)
    throw new Error('invalid_forwarding_database_configuration');
  let uri;
  try{uri=new URL(value);}catch{throw new Error('invalid_forwarding_database_configuration');}
  if(!['postgres:','postgresql:'].includes(uri.protocol) ||
     decodeURIComponent(uri.username)!=='nexlupa_resend_ingest' ||
     uri.password.length<8 ||
     decodeURIComponent(uri.pathname)!=='/nexlupa_pilot' ||
     !URL_HOST.test(uri.hostname) || uri.hash || uri.searchParams.getAll('sslmode').length!==1 ||
     uri.searchParams.get('sslmode')!=='verify-full' ||
     uri.searchParams.getAll('channel_binding').length>1 ||
     (uri.searchParams.has('channel_binding') &&
      !['require','prefer'].includes(uri.searchParams.get('channel_binding'))) ||
     (uri.port && uri.port!=='5432') ||
     [...uri.searchParams.keys()].some(x=>!['channel_binding','sslmode'].includes(x)))
    throw new Error('invalid_forwarding_database_configuration');
  return uri.toString();
}

function readConfig(env=process.env){
  const config={
    vercelEnv:env.VERCEL_ENV,
    gitRef:env.VERCEL_GIT_COMMIT_REF,
    enabled:env.FORWARDING_PILOT_ENABLED,
    webhookSecret:env.FORWARDING_PILOT_WEBHOOK_SECRET,
    encryptionKeyHex:env.FORWARDING_PILOT_ENCRYPTION_KEY
  };
  // Missing secrets must not be silently accepted.
  let dbUrl=null;
  try{dbUrl=validateConnectionString(env.FORWARDING_PILOT_DATABASE_URL);}
  catch{}
  const configured=Boolean(
    dbUrl &&
    typeof config.webhookSecret==='string' &&
    /^whsec_[A-Za-z0-9+/]+={0,2}$/.test(config.webhookSecret) &&
    typeof config.encryptionKeyHex==='string' &&
    /^[0-9a-f]{64}$/i.test(config.encryptionKeyHex)
  );
  return {...config,configured,databaseUrl:configured?dbUrl:null};
}

function createRuntimeHandler(env=process.env){
  const config=readConfig(env);
  // Lazy loading: neither a PostgreSQL connection nor a webhook read is
  // possible when the feature flag is off, even on an enabled Vercel preview.
  let pool=null;
  async function createAdapters(){
    if(config.vercelEnv!=='preview' || config.gitRef!==ALLOWED_BRANCH ||
       config.enabled!=='true' || config.configured!==true)
      throw new Error('preview_only');
    if(!pool){
      const {Pool}=require('pg');
      pool=new Pool({
        connectionString:config.databaseUrl,
        ssl:{rejectUnauthorized:true},
        max:1,idleTimeoutMillis:1000,connectionTimeoutMillis:3000,
        query_timeout:5000,statement_timeout:5000
      });
    }
    const query=(sql,params)=>pool.query(sql,params);
    return createNeonReceiptAdapters({
      query,encryptionKeyHex:config.encryptionKeyHex
    });
  }
  return makeHttpHandler({config,createAdapters});
}
module.exports={createRuntimeHandler,readConfig,validateConnectionString};
