'use strict';
/**
 * Disposable filesystem-only Vercel static build preview gate.
 * Never connects to Neon, Meta, real Vercel or credentials. Never edits
 * the working repository's public/ or calls a deployment API.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const realBuildScript=path.resolve(__dirname,'../scripts/build-static.js');
const requiredAssets=[
 'index.html','style.css','script.js','hero.png',
 'app/index.html','app/script.js','app/style.css',
 'app/assets/logo-white.png','app/assets/nexlupa-logo-dark.png',
 'app/assets/nexlupa-logo-light.png',
 'landing/index.html','landing/script.js','landing/style.css',
 'landing/hero.png'
];
const pilotAssets=['pilot-auth/index.html','pilot-auth/script.js'];
const privateAssets=[
 'lib/whatsapp/meta-phone-proof-issuer.js',
 'lib/whatsapp/pilot-web-consent.js',
 'db/migrations/20261111_whatsapp_web_receipt_issuer_ci.sql',
 'tests/whatsapp-signed-atomic-activation.test.cjs',
 '.github/workflows/whatsapp-consent-policy-tests.yml',
 'docs/architecture/whatsapp-signed-atomic-activation-20261111.md',
 'pilot-auth/private-session-dump.json',
 'api/private-whatsapp-signing.js'
];
const safeOrigin='https://nexlupa-build-boundary-test.vercel.app';
function filesUnder(dir){
 if(!fs.existsSync(dir))return [];
 const found=[];
 for(const name of fs.readdirSync(dir)){
  const p=path.join(dir,name);
  if(fs.statSync(p).isDirectory())found.push(
    ...filesUnder(p).map(x=>name+'/'+x));
  else found.push(name);
 }
 return found.sort();
}
function run(root,env){
 const actual=spawnSync(process.execPath,
  [path.join(root,'scripts/build-static.js')],{
    cwd:root,
    env:{
      PATH:process.env.PATH,
      VERCEL_ENV:'production',
      NEXLUPA_AUTH_PILOT:'enabled',
      NEXLUPA_AUTH_PILOT_ORIGIN:safeOrigin,
      ...env
    },
    encoding:'utf8',timeout:15000
  });
 assert.equal(actual.status,0,
  'static preview build failed: '+actual.stderr);
 return filesUnder(path.join(root,'public'));
}
test('static build excludes all staging SQL, functions and hidden test files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexlupa-preview-ci-'));
 try{
  const write=(relative,body)=>{
   const full=path.join(root,relative);
   fs.mkdirSync(path.dirname(full),{recursive:true});
   fs.writeFileSync(full,body);
  };
  write('scripts/build-static.js',fs.readFileSync(realBuildScript,'utf8'));
  for(const file of [...requiredAssets,...pilotAssets,...privateAssets])
   write(file,'PRIVATE_STAGED_MARKER_CI_'+file);
  // Even when a production operator accidentally provides preview flags
  // and a plausible *.vercel.app origin, production never serves login.
  assert.deepEqual(run(root,{VERCEL_ENV:'production'}),
    requiredAssets.slice().sort());

  // Preview is still private unless *every* preview switch is enabled.
  assert.deepEqual(run(root,{VERCEL_ENV:'preview',
    NEXLUPA_AUTH_PILOT:'disabled'}),
    requiredAssets.slice().sort());
  assert.deepEqual(run(root,{VERCEL_ENV:'preview',
    NEXLUPA_AUTH_PILOT:'enabled',
    NEXLUPA_AUTH_PILOT_ORIGIN:'https://attacker.example'}),
    requiredAssets.slice().sort());

  const previewFiles=run(root,{VERCEL_ENV:'preview',
    NEXLUPA_AUTH_PILOT:'enabled',NEXLUPA_AUTH_PILOT_ORIGIN:safeOrigin});
  assert.deepEqual(previewFiles,
    [...requiredAssets,...pilotAssets].sort());

  // A later production build must delete the earlier private pilot page.
  assert.deepEqual(run(root,{VERCEL_ENV:'production'}),
    requiredAssets.slice().sort());
  for(const file of [...privateAssets,...pilotAssets]){
   assert.equal(fs.existsSync(path.join(root,'public',file)),false,
    'private file leaked to public: '+file);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
