'use strict';
// Disposable PostgreSQL 16 ONLY. Tests SECURITY DEFINER + no BYPASSRLS
// with unsigned, replayed, cross-family and rolled-back synthetic inputs.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID,createHmac}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {Pool}=require('pg');
const {createSignedAtomicConsentClient}=
 require('../lib/whatsapp/signed-atomic-consent-client');
const {createPilotAtomicConsentFactory}=
 require('../lib/whatsapp/pilot-atomic-consent');
const {createMetaPhoneProofIssuer,ISSUE_SQL:ISSUE_META_PROOF_SQL}=
 require('../lib/whatsapp/meta-phone-proof-issuer');
const {createSignedWebConsentIssuer,SIGNED_WEB_RECEIPT_SQL}=
 require('../lib/whatsapp/pilot-web-consent');
const {pairingDigest}=
 require('../lib/whatsapp/family-pairing-protocol');
const {PILOT_COOKIE,encodePilotSession}=
 require('../lib/whatsapp/pilot-auth-bff');
const {CONSENT_VERSION}=
 require('../lib/whatsapp/family-pairing-protocol');

const dbUrl=process.env.WHATSAPP_TEST_DATABASE_URL;
const ROLE='nex_ci_atomic_activation_runtime';
const FN='public.nex_ci_signed_activate_atomic_consent';
const KEY_ID='synthetic-activation-key';
const VERSION='ci-signed-1';
const USER='synthetic-admin';
const A='a0000000-0000-4000-8000-000000000911';
const B='b0000000-0000-4000-8000-000000000922';
const BIZ='9988771122',PHONE='8877661122';
const key=randomBytes(32);
const SQL=`SELECT ${FN}(
 $1,$2::uuid,$3,$4,$5::bytea,$6::bytea,$7,$8,$9::bigint,$10::uuid,$11::bytea
) AS result`;

function permit({user=USER,family=A,proof,receipt,
  business=BIZ,phone=PHONE,nonce=randomUUID(),
  expires=Math.floor(Date.now()/1000)+45,signature}){
 const payload=['NEXLUPA-ATOMIC-ACTIVATE-1',KEY_ID,user,family,
   business,phone,proof.toString('hex'),receipt.toString('hex'),
   VERSION,String(expires),nonce].join('|');
 const signed=signature||createHmac('sha256',key).update(payload).digest();
 return [user,family,business,phone,proof,receipt,VERSION,KEY_ID,expires,nonce,signed];
}
function makeIds(suffix){
 return {proof:randomBytes(32),receipt:randomBytes(32),
  sender:randomBytes(32),suffix};
}
async function seed(pool,ids,{family=A,sender=ids.sender,version=VERSION}={}){
 await pool.query('INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
  '(proof_digest,family_id,business_account_id,phone_number_id,sender_digest,'+
  "verified_at,expires_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp(),"+
  "clock_timestamp()+interval '10 minutes')",
  [ids.proof,family,BIZ,PHONE,sender]);
 await pool.query('INSERT INTO public.nex_whatsapp_explicit_receipt_proofs '+
  '(receipt_digest,proof_digest,family_id,business_account_id,phone_number_id,'+
  'sender_digest,scope,consent_version,source,accepted_at,expires_at) '+
  "VALUES($1,$2,$3,$4,$5,$6,'incoming_text',$7,"+
  "'account-web-consent',clock_timestamp(),clock_timestamp()+interval '10 minutes')",
  [ids.receipt,ids.proof,family,BIZ,PHONE,sender,version]);
}
async function rows(pool,ids){
 const c=await pool.query('SELECT COUNT(*)::int AS n FROM '+
  'public.nex_whatsapp_sender_authorizations WHERE business_account_id=$1 '+
  'AND consent_receipt_digest=$2',[BIZ,ids.receipt]);
 const p=await pool.query('SELECT consumed_at FROM '+
  'public.nex_whatsapp_verified_phone_proofs WHERE proof_digest=$1',[ids.proof]);
 const r=await pool.query('SELECT consumed_at FROM '+
  'public.nex_whatsapp_explicit_receipt_proofs WHERE receipt_digest=$1',[ids.receipt]);
 return {count:c.rows[0].n,proofUsed:!!p.rows[0]?.consumed_at,
  receiptUsed:!!r.rows[0]?.consumed_at};
}
test('signed limited-role activation: deny direct access, verify signatures, one-use and atomic rollback',{
 skip:!dbUrl,timeout:60000
},async()=>{
 const pool=new Pool({connectionString:dbUrl,max:8,
  connectionTimeoutMillis:6000,statement_timeout:10000});
 let runtime1,runtime2;
 try{
  for(const migration of [
   '20261108_whatsapp_durable_inbox.sql',
   '20261109_whatsapp_explicit_consent_receipt.sql',
   '20261110_whatsapp_atomic_pairing_evidence_staged.sql',
   '20261109_nexlupa_canonical_identity_staged.sql',
   '20261111_whatsapp_signed_atomic_activation_ci.sql'
  ]) {
   // TTP240 canonical identity migration is a psql script; node-postgres
   // executes the SQL portion only (psql backslash commands are client-only).
   const migrationSql=readFileSync(join(__dirname,'../db/migrations',migration),'utf8')
     .split('\n').filter(line=>!line.startsWith('\\')).join('\n');
   await pool.query(migrationSql);
  }
  // Minimal TTP236 challenge schema for this isolated PG16 test; the full
  // pairing issuer is tested separately in PostgreSQL 17 CI.
  await pool.query("CREATE TABLE public.nex_ci_whatsapp_pairing_challenges ("+
    "challenge_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,"+
    "family_id uuid NOT NULL, business_account_id text NOT NULL,"+
    "phone_number_id text NOT NULL, code_digest bytea NOT NULL UNIQUE,"+
    "requested_by text NOT NULL, consent_version text NOT NULL,"+
    "created_at timestamptz NOT NULL DEFAULT clock_timestamp(),"+
    "expires_at timestamptz NOT NULL, consumed_at timestamptz)");
  await pool.query("REVOKE ALL ON public.nex_ci_whatsapp_pairing_challenges FROM PUBLIC");
  await pool.query("ALTER TABLE public.nex_ci_whatsapp_pairing_challenges ENABLE ROW LEVEL SECURITY");
  await pool.query("ALTER TABLE public.nex_ci_whatsapp_pairing_challenges FORCE ROW LEVEL SECURITY");
  await pool.query(readFileSync(join(__dirname,
    '../db/migrations/20261111_whatsapp_verified_meta_proof_issuer_ci.sql'),'utf8'));
  await pool.query('INSERT INTO public.nex_ci_atomic_activation_keys '+
   '(key_id,key_data,state) VALUES($1,$2,$3)',[KEY_ID,key,'active']);
  // Canonical, staged TTP240 tables -- NO synthetic membership copy.
  await pool.query('INSERT INTO public.nex_users(user_id) VALUES($1)',[USER]);
  await pool.query('INSERT INTO public.nex_families(family_id,display_name) '+
    'VALUES($1,$2)',[A,'CI atomic consent family']);
  await pool.query('INSERT INTO public.nex_family_memberships '+
    '(user_id,family_id,role,status) VALUES($1,$2,$3,$4)',
    [USER,A,'admin','active']);

  runtime1=await pool.connect();
  await runtime1.query('SET ROLE '+ROLE);
  assert.equal((await runtime1.query('SELECT CURRENT_USER AS role')).rows[0].role,ROLE);
  for(const table of [
   'nex_whatsapp_verified_phone_proofs',
   'nex_whatsapp_explicit_receipt_proofs',
   'nex_ci_atomic_activation_keys','nex_family_memberships',
   'nex_users','nex_families',
   'nex_whatsapp_sender_authorizations',
   'nex_ci_atomic_activation_nonces']){
   await assert.rejects(runtime1.query('SELECT * FROM public.'+table+' LIMIT 1'),
    e=>e.code==='42501','runtime SELECT must be denied: '+table);
  }
  await assert.rejects(runtime1.query(
    'UPDATE public.nex_whatsapp_verified_phone_proofs '+
    'SET consumed_at=clock_timestamp()'),e=>e.code==='42501');

  const signed=makeIds('good');
  await seed(pool,signed);
  const forged=permit({...signed,signature:Buffer.alloc(32)});
  assert.deepEqual((await runtime1.query(SQL,forged)).rows[0].result,{state:'rejected'});
  assert.deepEqual(await rows(pool,signed),{count:0,proofUsed:false,receiptUsed:false});
  const foreign=permit({...signed,family:B});
  assert.deepEqual((await runtime1.query(SQL,foreign)).rows[0].result,{state:'rejected'});
  assert.deepEqual(await rows(pool,signed),{count:0,proofUsed:false,receiptUsed:false});

  const good=permit(signed);
  assert.deepEqual((await runtime1.query(SQL,good)).rows[0].result,{state:'enrolled'});
  assert.deepEqual(await rows(pool,signed),{count:1,proofUsed:true,receiptUsed:true});
  assert.deepEqual((await runtime1.query(SQL,good)).rows[0].result,{state:'rejected'});
  const nonces=await pool.query('SELECT COUNT(*)::int AS n FROM '+
   'public.nex_ci_atomic_activation_nonces WHERE nonce=$1',[good[9]]);
  assert.equal(nonces.rows[0].n,1);

  // Same sender, second fresh receipt: unique active sender guard rejects
  // without consuming the second pair of proofs.
  const duplicate=makeIds('dupe');
  await seed(pool,duplicate,{sender:signed.sender});
  assert.deepEqual((await runtime1.query(SQL,permit(duplicate))).rows[0].result,
   {state:'rejected'});
  assert.deepEqual(await rows(pool,duplicate),
   {count:0,proofUsed:false,receiptUsed:false});

  // Fault AFTER auth INSERT: a trigger rejects receipt consumption, and
  // PostgreSQL must automatically undo INSERT, nonce and proof update.
  const fail=makeIds('rollback');
  await seed(pool,fail);
  await pool.query(`
CREATE FUNCTION public.nex_ci_atomic_fail_on_receipt() RETURNS trigger
LANGUAGE plpgsql AS $f$BEGIN
 RAISE EXCEPTION 'CI receipt consumption error';
END;$f$;
CREATE TRIGGER nex_ci_atomic_force_failure BEFORE UPDATE OF consumed_at
ON public.nex_whatsapp_explicit_receipt_proofs FOR EACH ROW
EXECUTE FUNCTION public.nex_ci_atomic_fail_on_receipt();
`);
  const broken=permit(fail);
  await assert.rejects(runtime1.query(SQL,broken),/CI receipt consumption error/);
  assert.deepEqual(await rows(pool,fail),{count:0,proofUsed:false,receiptUsed:false});
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM '+
   'public.nex_ci_atomic_activation_nonces WHERE nonce=$1',[broken[9]])).rows[0].n,0);
  await pool.query('DROP TRIGGER nex_ci_atomic_force_failure ON '+
   'public.nex_whatsapp_explicit_receipt_proofs');
  await pool.query('DROP FUNCTION public.nex_ci_atomic_fail_on_receipt()');
  assert.deepEqual((await runtime1.query(SQL,broken)).rows[0].result,{state:'enrolled'});
  assert.deepEqual(await rows(pool,fail),{count:1,proofUsed:true,receiptUsed:true});

  // Two separate restricted SQL connections racing for one proof.
  const concurrent=makeIds('race');
  await seed(pool,concurrent);
  runtime2=await pool.connect();await runtime2.query('SET ROLE '+ROLE);
  const responses=await Promise.all([
   runtime1.query(SQL,permit(concurrent)),
   runtime2.query(SQL,permit(concurrent))
  ]);
  assert.deepEqual(responses.map(x=>x.rows[0].result.state).sort(),
   ['enrolled','rejected']);
  assert.deepEqual(await rows(pool,concurrent),{count:1,proofUsed:true,receiptUsed:true});

  // Complete JS -> restricted SQL integration on the same actual PG16 role.
  const challengeId='ci_verified_phone_proof_20261111';
  const receiptId='ci_explicit_web_receipt_20261111';
  const proofKey=randomBytes(32),receiptKey=randomBytes(32);
  const full={
   proof:createHmac('sha256',proofKey)
    .update('nexlupa:phone-proof:v1:').update(challengeId).digest(),
   receipt:createHmac('sha256',receiptKey)
    .update('nexlupa:consent-receipt:v1:').update(receiptId).digest(),
   sender:randomBytes(32)
  };
  await seed(pool,full);
  const signedClient=createSignedAtomicConsentClient({
   db:{connect:async()=>({query:(sql,args)=>runtime1.query(sql,args),
      release(){/* runtime1 remains dedicated to this synthetic suite */}})},
   proofHmacKey:proofKey.toString('base64'),
   receiptHmacKey:receiptKey.toString('base64'),
   consentVersion:VERSION,
   bindVerifiedRequest:async()=>({
    authorizeFamily:async({familyId,action})=>
      familyId===A&&action==='enroll_whatsapp_sender',
    getVerifiedPrincipal:async()=>({
      userId:USER,sessionId:'synthetic-verified-session'
    })
   }),
   getActiveSigningKey:async purpose=>({
    purpose,state:'active',keyId:KEY_ID,keyBase64:key.toString('base64')
   })
  });
  const fullRequest={familyId:A,businessAccountId:BIZ,phoneNumberId:PHONE,
    challengeId,consentReceiptId:receiptId};
  assert.deepEqual(await signedClient(fullRequest),{state:'enrolled'});
  assert.deepEqual(await rows(pool,full),
    {count:1,proofUsed:true,receiptUsed:true});
  assert.deepEqual(await signedClient(fullRequest),{state:'rejected'});

  // A still-valid signed permit never overrides a removed administrator.
  const member=makeIds('removed-membership');
  await seed(pool,member);
  await pool.query("UPDATE public.nex_family_memberships SET role='member' "+
   'WHERE user_id=$1 AND family_id=$2',[USER,A]);
  assert.deepEqual((await runtime1.query(SQL,permit(member))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,member),
    {count:0,proofUsed:false,receiptUsed:false});
  await pool.query("UPDATE public.nex_family_memberships SET role='admin' "+
    'WHERE user_id=$1 AND family_id=$2',[USER,A]);

  // The restricted runtime must NEVER be able to grant itself a family role.
  await assert.rejects(runtime1.query(
    "UPDATE public.nex_family_memberships SET role='admin' "+
    "WHERE user_id=$1 AND family_id=$2",[USER,A]),e=>e.code==='42501');

  // Signed permits for a non-member must fail even if the phone and receipt
  // evidence are correct and all other signature fields are valid.
  const stranger=makeIds('unknown-user');
  await seed(pool,stranger);
  assert.deepEqual((await runtime1.query(SQL,
    permit({...stranger,user:'unknown-account'}))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,stranger),
    {count:0,proofUsed:false,receiptUsed:false});

  // True two-connection race: the admin revocation holds the canonical row
  // lock. The signed activation must WAIT for that transaction, then deny.
  const racingAdmin=makeIds('membership-revoke-race');
  await seed(pool,racingAdmin);
  const adminTx=await pool.connect();
  let adminTxOpen=false;
  let pending;
  try{
    await adminTx.query('BEGIN');adminTxOpen=true;
    await adminTx.query(
      "UPDATE public.nex_family_memberships SET role='member' "+
      "WHERE user_id=$1 AND family_id=$2",[USER,A]);
    pending=runtime1.query(SQL,permit(racingAdmin));
    let blocked=false;
    for(let i=0;i<100;i++){
      const {rows:stats}=await pool.query(
        "SELECT COUNT(*)::int AS waiting FROM pg_stat_activity "+
        "WHERE datname=current_database() "+
        "AND wait_event_type='Lock' AND state='active' "+
        "AND query LIKE '%nex_ci_signed_activate_atomic_consent%'");
      if(stats[0].waiting>0){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    assert.equal(blocked,true,'signed activation must wait for concurrent admin revocation');
    await adminTx.query('COMMIT');adminTxOpen=false;
    assert.deepEqual((await pending).rows[0].result,{state:'rejected'});
    assert.deepEqual(await rows(pool,racingAdmin),
      {count:0,proofUsed:false,receiptUsed:false});
  }finally{
    if(adminTxOpen)await adminTx.query('ROLLBACK');
    if(pending)await pending.catch(()=>{});
    adminTx.release();
    await pool.query(
      "UPDATE public.nex_family_memberships SET role='admin' "+
      "WHERE user_id=$1 AND family_id=$2",[USER,A]);
  }

  // The canonical identity policy (TTP240), not a parallel fixture,
  // rejects suspended memberships, disabled users and archived families.
  const suspended=makeIds('suspended');
  await seed(pool,suspended);
  await pool.query("UPDATE public.nex_family_memberships SET status='suspended',"+
    "updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2",[USER,A]);
  assert.deepEqual((await runtime1.query(SQL,permit(suspended))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,suspended),
    {count:0,proofUsed:false,receiptUsed:false});
  await pool.query("UPDATE public.nex_family_memberships SET status='active',"+
    "updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2",[USER,A]);

  const disabled=makeIds('disabled-user');
  await seed(pool,disabled);
  await pool.query('UPDATE public.nex_users SET disabled_at=clock_timestamp() '+
    'WHERE user_id=$1',[USER]);
  assert.deepEqual((await runtime1.query(SQL,permit(disabled))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,disabled),
    {count:0,proofUsed:false,receiptUsed:false});
  await pool.query('UPDATE public.nex_users SET disabled_at=NULL WHERE user_id=$1',[USER]);

  const archived=makeIds('archived-family');
  await seed(pool,archived);
  await pool.query('UPDATE public.nex_families SET archived_at=clock_timestamp() '+
    'WHERE family_id=$1',[A]);
  assert.deepEqual((await runtime1.query(SQL,permit(archived))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,archived),
    {count:0,proofUsed:false,receiptUsed:false});
  await pool.query('UPDATE public.nex_families SET archived_at=NULL WHERE family_id=$1',[A]);

  const revokedMember=makeIds('revoked-canonical-member');
  await seed(pool,revokedMember);
  await pool.query("UPDATE public.nex_family_memberships SET revoked_at=clock_timestamp(),"+
    "updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2",[USER,A]);
  assert.deepEqual((await runtime1.query(SQL,permit(revokedMember))).rows[0].result,
    {state:'rejected'});
  assert.deepEqual(await rows(pool,revokedMember),
    {count:0,proofUsed:false,receiptUsed:false});
  await pool.query("UPDATE public.nex_family_memberships SET revoked_at=NULL,"+
    "updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2",[USER,A]);

  // End-to-end synthetic pilot boundary:
  // Fake verified Neon Auth session -> real restricted canonical identity
  // reader -> REAL canonical family lock -> signed restricted atomic RPC.
  // No network, Meta, family data or deployed Vercel route.
  const previewOrigin='https://nexlupa-atomic-ci.vercel.app';
  const previewAuth='https://ep-ci.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
  const previewSubject='external-atomic-pilot-1';
  const previewToken='CI-ATOMIC-PILOT-SESSION-000000000000';
  const pilotChallengeId='ci_preview_verified_phone_00001';
  const pilotReceiptId='ci_preview_explicit_receipt_00001';
  const pilotProofKey=randomBytes(32),pilotReceiptKey=randomBytes(32);
  const pilotEvidence={
    proof:createHmac('sha256',pilotProofKey)
      .update('nexlupa:phone-proof:v1:').update(pilotChallengeId).digest(),
    receipt:createHmac('sha256',pilotReceiptKey)
      .update('nexlupa:consent-receipt:v1:').update(pilotReceiptId).digest(),
    sender:randomBytes(32)
  };
  await seed(pool,pilotEvidence,{version:CONSENT_VERSION});
  await pool.query('INSERT INTO public.nex_idp_identity_links '+
    '(issuer,subject,user_id) VALUES($1,$2,$3)',
    [previewAuth,previewSubject,USER]);
  const identityReader=await pool.connect();
  try{
    await identityReader.query('SET ROLE nex_ci_canonical_identity_runtime');
    await assert.rejects(identityReader.query('SELECT * FROM public.nex_users'),
      e=>e.code==='42501');
    const baseTime=Date.now();
    let fetched=0;
    const fakeSessionFetch=async(url,options)=>{
      fetched++;
      assert.equal(url,previewAuth+'/get-session?disableCookieCache=true');
      assert.equal(options.headers.Cookie,
        'better-auth.session_token='+previewToken);
      return {status:200,headers:{get:x=>x==='content-type'?
        'application/json':null},
       text:async()=>JSON.stringify({
        user:{id:previewSubject},
        session:{id:'ci-verified-session-1',userId:previewSubject,
          createdAt:new Date(baseTime-60000).toISOString(),
          expiresAt:new Date(baseTime+60000).toISOString()}
       })
      };
    };
    const previewFactory=createPilotAtomicConsentFactory({
      env:{
        VERCEL_ENV:'preview',NEXLUPA_AUTH_PILOT:'enabled',
        NEXLUPA_AUTH_PILOT_ORIGIN:previewOrigin,
        NEXLUPA_AUTH_BASE_URL:previewAuth,
        NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS:previewSubject,
        WHATSAPP_WABA_ID:BIZ,WHATSAPP_PHONE_NUMBER_ID:PHONE
      },
      identityDb:{query:(sql,args)=>identityReader.query(sql,args)},
      activationDb:{connect:async()=>({
        query:(sql,args)=>runtime1.query(sql,args),release(){}
      })},
      proofHmacKey:pilotProofKey.toString('base64'),
      receiptHmacKey:pilotReceiptKey.toString('base64'),
      getActiveSigningKey:async purpose=>({
        purpose,state:'active',keyId:KEY_ID,
        keyBase64:key.toString('base64')
      }),
      fetchImpl:fakeSessionFetch,now:()=>baseTime
    });
    const previewRequest={
      method:'POST',
      headers:{
        host:'nexlupa-atomic-ci.vercel.app',
        'x-forwarded-proto':'https',
        origin:previewOrigin,'sec-fetch-site':'same-origin',
        cookie:PILOT_COOKIE+'='+encodePilotSession(
          'better-auth.session_token='+previewToken)
      },body:{userId:'nonexistent-admin',role:'owner',familyId:B}
    };
    const previewActivate=previewFactory(previewRequest);
    const previewInput={familyId:A,challengeId:pilotChallengeId,
      consentReceiptId:pilotReceiptId,
      userId:'nonexistent-admin',role:'owner'};
    assert.deepEqual(await previewActivate(previewInput),{state:'enrolled'});
    assert.deepEqual(await rows(pool,pilotEvidence),
      {count:1,proofUsed:true,receiptUsed:true});
    assert.ok(fetched>=3,'real preview adapter must recheck IdP session');
    assert.deepEqual(await previewActivate(previewInput),{state:'rejected'});
    // Identity-link revocation defeats a still-valid browser cookie.
    const pilotRevoked=makeIds('idp-link-revocation');
    await seed(pool,pilotRevoked,{version:CONSENT_VERSION});
    await pool.query('UPDATE public.nex_idp_identity_links SET '+
      'revoked_at=clock_timestamp() WHERE issuer=$1 AND subject=$2',
      [previewAuth,previewSubject]);
    await assert.rejects(previewActivate({
      ...previewInput,challengeId:'unused_new_challenge_123',
      consentReceiptId:'unused_new_receipt_123'
    }),/verified active server session/i);
    assert.deepEqual(await rows(pool,pilotRevoked),
      {count:0,proofUsed:false,receiptUsed:false});
  }finally{
    await identityReader.query('RESET ROLE');
    identityReader.release();
  }

  // Meta proof issuer: the webhook signature is verified against original
  // raw bytes. Signed permit only creates a phone-proof row, never consent.
  const code='ABCD-EFGH-JKLM-NPQR';
  const proofBiz=BIZ,proofPhone=PHONE;
  const metaSecret='CI-META-APP-SECRET-ONLY';
  const metaSenderKey=randomBytes(32),metaPairingKey=randomBytes(32),
    metaProofKey=randomBytes(32),metaSignerKey=randomBytes(32);
  const codeDigest=pairingDigest({code,businessAccountId:proofBiz,
    phoneNumberId:proofPhone,pairingKey:metaPairingKey});
  const metaProofDigest=createHmac('sha256',metaProofKey)
    .update('nexlupa:phone-proof:v1:').update(code).digest();
  await pool.query(
    'INSERT INTO public.nex_ci_meta_proof_signing_keys '+
    '(key_id,key_data,state) VALUES($1,$2,$3)',
    ['ci-meta-proof-key',metaSignerKey,'active']);
  await pool.query(
    'INSERT INTO public.nex_ci_whatsapp_pairing_challenges '+
    '(family_id,business_account_id,phone_number_id,code_digest,'+
    'requested_by,consent_version,expires_at) '+
    "VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '9 minutes')",
    [A,proofBiz,proofPhone,codeDigest,USER,CONSENT_VERSION]);
  const metaRuntime=await pool.connect();
  try{
    await metaRuntime.query('SET ROLE nex_ci_meta_proof_runtime');
    for(const table of ['nex_ci_whatsapp_pairing_challenges',
      'nex_whatsapp_verified_phone_proofs','nex_ci_meta_proof_signing_keys',
      'nex_ci_meta_proof_provider_receipts','nex_ci_meta_proof_operation_nonces']){
      await assert.rejects(metaRuntime.query('SELECT * FROM public.'+table),
        e=>e.code==='42501');
    }
    const metaProofIssuer=createMetaPhoneProofIssuer({
      db:{connect:async()=>({query:(sql,args)=>metaRuntime.query(sql,args),
        release(){}})},
      metaAppSecret:metaSecret,
      senderHmacKey:metaSenderKey.toString('base64'),
      pairingHmacKey:metaPairingKey.toString('base64'),
      proofHmacKey:metaProofKey.toString('base64'),
      businessAccountId:proofBiz,phoneNumberId:proofPhone,
      getActiveSigningKey:async purpose=>({
        purpose,state:'active',keyId:'ci-meta-proof-key',
        keyBase64:metaSignerKey.toString('base64')
      })
    });
    const makeEvent=(id='wamid.ci-verified-phone-1',word=code)=>
      Buffer.from(JSON.stringify({object:'whatsapp_business_account',
        entry:[{id:proofBiz,changes:[{field:'messages',value:{
          metadata:{phone_number_id:proofPhone},
          messages:[{id,from:'34611111111',
            timestamp:String(Math.floor(Date.now()/1000)),
            type:'text',text:{body:'NEXLUPA ACCEPTA '+word}}]
        }}]}]}));
    const raw=makeEvent(),mac=bytes=>'sha256='+
      createHmac('sha256',metaSecret).update(bytes).digest('hex');
    const previousAuth=(await pool.query(
      'SELECT COUNT(*)::int AS n FROM public.nex_whatsapp_sender_authorizations '+
      'WHERE business_account_id=$1',[BIZ])).rows[0].n;
    assert.deepEqual(await metaProofIssuer(raw,'sha256='+'0'.repeat(64)),
      {state:'rejected'});
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM '+
      'public.nex_whatsapp_verified_phone_proofs WHERE proof_digest=$1',
      [metaProofDigest])).rows[0].n,0);
    assert.deepEqual(await metaProofIssuer(raw,mac(raw)),{state:'verified'});
    const metaRecord=await pool.query('SELECT family_id,business_account_id,'+
      'phone_number_id,sender_digest,consumed_at FROM '+
      'public.nex_whatsapp_verified_phone_proofs WHERE proof_digest=$1',
      [metaProofDigest]);
    assert.equal(metaRecord.rowCount,1);
    assert.equal(metaRecord.rows[0].family_id,A);
    assert.equal(metaRecord.rows[0].business_account_id,BIZ);
    assert.equal(metaRecord.rows[0].phone_number_id,PHONE);
    assert.equal(metaRecord.rows[0].consumed_at,null);
    assert.deepEqual(metaRecord.rows[0].sender_digest,
      createHmac('sha256',metaSenderKey).update('34611111111').digest());
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM '+
      'public.nex_whatsapp_sender_authorizations WHERE business_account_id=$1',
      [BIZ])).rows[0].n,previousAuth,'phone proof is NOT explicit consent');
    assert.deepEqual(await metaProofIssuer(raw,mac(raw)),{state:'rejected'});
    const replay=makeEvent('wamid.ci-meta-new-id');
    assert.deepEqual(await metaProofIssuer(replay,mac(replay)),{state:'rejected'});
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM '+
      'public.nex_ci_meta_proof_provider_receipts WHERE business_account_id=$1',
      [BIZ])).rows[0].n,1);

    // Signed Meta proof must refuse a challenge whose canonical admin was
    // suspended AFTER creating the challenge.
    const otherCode='ABCD-EFGH-JKLM-NPQS';
    const otherDigest=pairingDigest({code:otherCode,
      businessAccountId:BIZ,phoneNumberId:PHONE,pairingKey:metaPairingKey});
    await pool.query(
      'INSERT INTO public.nex_ci_whatsapp_pairing_challenges '+
      '(family_id,business_account_id,phone_number_id,code_digest,'+
      'requested_by,consent_version,expires_at) '+
      "VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '9 minutes')",
      [A,BIZ,PHONE,otherDigest,USER,CONSENT_VERSION]);
    await pool.query("UPDATE public.nex_family_memberships SET status='suspended',"+
      'updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2',[USER,A]);
    const deniedRaw=makeEvent('wamid.ci-meta-denied',otherCode);
    assert.deepEqual(await metaProofIssuer(deniedRaw,mac(deniedRaw)),
      {state:'rejected'});
    assert.equal((await pool.query(
      'SELECT COUNT(*)::int AS n FROM public.nex_ci_whatsapp_pairing_challenges '+
      'WHERE code_digest=$1 AND consumed_at IS NOT NULL',[otherDigest])).rows[0].n,0);
    await pool.query("UPDATE public.nex_family_memberships SET status='active',"+
      'updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2',[USER,A]);
  }finally{
    await metaRuntime.query('RESET ROLE');metaRuntime.release();
  }

  // Final synthetic link: verified Meta sender proof -> explicit web
  // consent receipt -> signed atomic activation. Each service uses its OWN
  // NOBYPASSRLS runtime, not the superuser that seeds CI fixture data.
  await pool.query(readFileSync(join(__dirname,
    '../db/migrations/20261111_whatsapp_web_receipt_issuer_ci.sql'),'utf8'));
  const webSigningKey=randomBytes(32),webReceiptHmacKey=randomBytes(32);
  await pool.query('INSERT INTO public.nex_ci_web_receipt_signing_keys '+
    '(key_id,key_data,state) VALUES($1,$2,$3)',
    ['web-receipt-ci-key',webSigningKey,'active']);
  const webRuntime=await pool.connect();
  try{
    await webRuntime.query('SET ROLE nex_ci_web_receipt_runtime');
    for(const table of ['nex_whatsapp_verified_phone_proofs',
      'nex_whatsapp_explicit_receipt_proofs',
      'nex_ci_web_receipt_signing_keys','nex_family_memberships',
      'nex_ci_web_receipt_operation_nonces']){
      await assert.rejects(webRuntime.query('SELECT * FROM public.'+table),
       e=>e.code==='42501');
    }
    const webIssuer=createSignedWebConsentIssuer({
      db:{connect:async()=>({
        query:(sql,args)=>webRuntime.query(sql,args),release(){}
      })},
      bindVerifiedRequest:async()=>({
        authorizeFamily:async({familyId,action})=>
          familyId===A && action==='enroll_whatsapp_sender',
        getVerifiedPrincipal:async()=>({
          userId:USER,sessionId:'verified-ci-web-session'
        })
      }),
      proofHmacKey:metaProofKey.toString('base64'),
      receiptHmacKey:webReceiptHmacKey.toString('base64'),
      getActiveSigningKey:async purpose=>({
        purpose,state:'active',keyId:'web-receipt-ci-key',
        keyBase64:webSigningKey.toString('base64')
      }),
      businessAccountId:BIZ,phoneNumberId:PHONE
    });
    const webInput={familyId:A,challengeId:code,
      accepted:true,versionAccepted:CONSENT_VERSION};
    await assert.rejects(webIssuer({...webInput,accepted:false}),/Explicit/);
    const issued=await webIssuer(webInput);
    assert.equal(issued.state,'issued');
    assert.match(issued.receiptId,/^[A-Za-z0-9_-]{32}$/);
    const digest=createHmac('sha256',webReceiptHmacKey)
      .update('nexlupa:consent-receipt:v1:')
      .update(issued.receiptId).digest();
    const receiptRow=await pool.query(
      'SELECT family_id,sender_digest,proof_digest,consent_version,'+
      'consumed_at FROM public.nex_whatsapp_explicit_receipt_proofs '+
      'WHERE receipt_digest=$1',[digest]);
    assert.equal(receiptRow.rowCount,1);
    assert.equal(receiptRow.rows[0].family_id,A);
    assert.equal(receiptRow.rows[0].consent_version,CONSENT_VERSION);
    assert.deepEqual(receiptRow.rows[0].sender_digest,
      createHmac('sha256',metaSenderKey).update('34611111111').digest());
    assert.deepEqual(receiptRow.rows[0].proof_digest,metaProofDigest);
    assert.equal(receiptRow.rows[0].consumed_at,null);
    assert.deepEqual(await webIssuer(webInput),{state:'rejected'},
      'same verified phone proof must never produce multiple receipts');

    // Only the verified session can sign activation, but even a stolen
    // runtime credential cannot directly read raw evidence or insert consent.
    const fullEnroll=createSignedAtomicConsentClient({
      db:{connect:async()=>({query:(sql,args)=>runtime1.query(sql,args),
       release(){}})},
      proofHmacKey:metaProofKey.toString('base64'),
      receiptHmacKey:webReceiptHmacKey.toString('base64'),
      consentVersion:CONSENT_VERSION,
      bindVerifiedRequest:async()=>({
        authorizeFamily:async({familyId,action})=>
          familyId===A&&action==='enroll_whatsapp_sender',
        getVerifiedPrincipal:async()=>({
          userId:USER,sessionId:'verified-ci-web-session'
        })
      }),
      getActiveSigningKey:async purpose=>({
        purpose,state:'active',keyId:KEY_ID,keyBase64:key.toString('base64')
      })
    });
    const enrolled=await fullEnroll({
      familyId:A,businessAccountId:BIZ,phoneNumberId:PHONE,
      challengeId:code,consentReceiptId:issued.receiptId
    });
    assert.deepEqual(enrolled,{state:'enrolled'});
    const used=await pool.query(
      'SELECT consumed_at FROM public.nex_whatsapp_verified_phone_proofs '+
      'WHERE proof_digest=$1',[metaProofDigest]);
    assert.ok(used.rows[0].consumed_at);
    const usedReceipt=await pool.query(
      'SELECT consumed_at FROM public.nex_whatsapp_explicit_receipt_proofs '+
      'WHERE receipt_digest=$1',[digest]);
    assert.ok(usedReceipt.rows[0].consumed_at);
    assert.deepEqual(await fullEnroll({
      familyId:A,businessAccountId:BIZ,phoneNumberId:PHONE,
      challengeId:code,consentReceiptId:issued.receiptId
    }),{state:'rejected'});

    // In-transaction web receipt creation must NOT race a revocation/
    // consumption of the signed Meta proof. Hold a competing write lock,
    // check that the restricted signed function blocks on FOR SHARE,
    // commit consumption, then reject without creating any web receipt.
    const lockingCode='ci_lock_evidence_token_00022';
    const lockingProof=createHmac('sha256',metaProofKey)
      .update('nexlupa:phone-proof:v1:').update(lockingCode).digest();
    await pool.query('INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
      '(proof_digest,family_id,business_account_id,phone_number_id,'+
      'sender_digest,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,'+
      "clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [lockingProof,A,BIZ,PHONE,randomBytes(32)]);
    const held=await pool.connect();
    let heldOpen=false,pending;
    try{
      await held.query('BEGIN');heldOpen=true;
      await held.query('UPDATE public.nex_whatsapp_verified_phone_proofs '+
       'SET consumed_at=clock_timestamp() WHERE proof_digest=$1',
       [lockingProof]);
      pending=webIssuer({familyId:A,challengeId:lockingCode,
        accepted:true,versionAccepted:CONSENT_VERSION});
      let waiting=false;
      for(let retry=0;retry<100;retry++){
        const tracked=await pool.query(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity "+
          "WHERE datname=current_database() AND wait_event_type='Lock' "+
          "AND state='active' AND query LIKE "+
          "'%nex_ci_signed_create_web_consent_receipt%'");
        if(tracked.rows[0].waiting>0){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      assert.equal(waiting,true,
       'Web receipt must await the competing proof consumption');
      await held.query('COMMIT');heldOpen=false;
      assert.deepEqual(await pending,{state:'rejected'});
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+
        'public.nex_whatsapp_explicit_receipt_proofs WHERE proof_digest=$1',
        [lockingProof])).rows[0].n,0);
    }finally{
      if(heldOpen)await held.query('COMMIT');
      if(pending)await pending.catch(()=>{});
      held.release();
    }

    // Two genuinely independent restricted database sessions race to
    // accept the SAME verified proof with separately generated receipts.
    // The one-receipt-per-proof index must reject the second issuance.
    const raceCode='ci_dual_web_receipts_00033';
    const raceProof=createHmac('sha256',metaProofKey)
      .update('nexlupa:phone-proof:v1:').update(raceCode).digest();
    await pool.query('INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
      '(proof_digest,family_id,business_account_id,phone_number_id,'+
      'sender_digest,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,'+
      "clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [raceProof,A,BIZ,PHONE,randomBytes(32)]);
    const secondWebRuntime=await pool.connect();
    try{
      await secondWebRuntime.query('SET ROLE nex_ci_web_receipt_runtime');
      const webIssuer2=createSignedWebConsentIssuer({
        db:{connect:async()=>({
          query:(sql,args)=>secondWebRuntime.query(sql,args),release(){}
        })},
        bindVerifiedRequest:async()=>({
          authorizeFamily:async({familyId,action})=>
            familyId===A&&action==='enroll_whatsapp_sender',
          getVerifiedPrincipal:async()=>({
            userId:USER,sessionId:'verified-ci-second-web-session'
          })
        }),
        proofHmacKey:metaProofKey.toString('base64'),
        receiptHmacKey:webReceiptHmacKey.toString('base64'),
        getActiveSigningKey:async purpose=>({
          purpose,state:'active',keyId:'web-receipt-ci-key',
          keyBase64:webSigningKey.toString('base64')
        }),
        businessAccountId:BIZ,phoneNumberId:PHONE
      });
      const raceRequest={familyId:A,challengeId:raceCode,
        accepted:true,versionAccepted:CONSENT_VERSION};
      const concurrentReceipts=await Promise.all([
        webIssuer(raceRequest),webIssuer2(raceRequest)
      ]);
      assert.deepEqual(
        concurrentReceipts.map(x=>x.state).sort(),['issued','rejected']);
      assert.equal((await pool.query(
        'SELECT count(*)::int AS n FROM '+
        'public.nex_whatsapp_explicit_receipt_proofs WHERE proof_digest=$1',
        [raceProof])).rows[0].n,1);
    }finally{
      await secondWebRuntime.query('RESET ROLE');
      secondWebRuntime.release();
    }

    // Even if the web-facing adapter was incorrectly permissive, the
    // canonical membership lock in the SQL issuer denies a suspended admin.
    const suspendedCode='ci_suspended_web_user_00044';
    const suspendedProof=createHmac('sha256',metaProofKey)
      .update('nexlupa:phone-proof:v1:').update(suspendedCode).digest();
    await pool.query('INSERT INTO public.nex_whatsapp_verified_phone_proofs '+
      '(proof_digest,family_id,business_account_id,phone_number_id,'+
      'sender_digest,verified_at,expires_at) VALUES($1,$2,$3,$4,$5,'+
      "clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [suspendedProof,A,BIZ,PHONE,randomBytes(32)]);
    await pool.query("UPDATE public.nex_family_memberships SET status='suspended',"+
      'updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2',
      [USER,A]);
    try{
      assert.deepEqual(await webIssuer({
        familyId:A,challengeId:suspendedCode,
        accepted:true,versionAccepted:CONSENT_VERSION
      }),{state:'rejected'});
      assert.equal((await pool.query(
        'SELECT count(*)::int AS n FROM '+
        'public.nex_whatsapp_explicit_receipt_proofs WHERE proof_digest=$1',
        [suspendedProof])).rows[0].n,0);
    }finally{
      await pool.query("UPDATE public.nex_family_memberships SET status='active',"+
        'updated_at=clock_timestamp() WHERE user_id=$1 AND family_id=$2',
        [USER,A]);
    }
  }finally{
    await webRuntime.query('RESET ROLE');webRuntime.release();
  }

  // Disabling the sole signing key must reject even otherwise valid evidence.
  const revoked=makeIds('revoked');
  await seed(pool,revoked);
  await pool.query("UPDATE public.nex_ci_atomic_activation_keys SET state='revoked' "+
   'WHERE key_id=$1',[KEY_ID]);
  assert.deepEqual((await runtime1.query(SQL,permit(revoked))).rows[0].result,
   {state:'rejected'});
  assert.deepEqual(await rows(pool,revoked),
   {count:0,proofUsed:false,receiptUsed:false});
 }finally{
  if(runtime2){await runtime2.query('RESET ROLE');runtime2.release();}
  if(runtime1){await runtime1.query('RESET ROLE');runtime1.release();}
  await pool.end();
 }
});
