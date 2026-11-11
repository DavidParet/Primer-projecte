'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../vercel.json'),'utf8'));
const builder=fs.readFileSync(path.resolve(__dirname,'../scripts/build-static.js'),'utf8');

// Public assets are intentionally allowlisted, never a copy of the whole repo.
const expected=[
  'index.html','style.css','script.js','hero.png',
  'app/index.html','app/script.js','app/style.css',
  'app/assets/logo-white.png','app/assets/nexlupa-logo-dark.png',
  'app/assets/nexlupa-logo-light.png',
  'landing/index.html','landing/script.js','landing/style.css','landing/hero.png'
];
const forbidden=[
  'docs/ai/nexlupa-core-ai-prompt.txt','.claude/settings.local.json',
  'tests/gmail-vercel-routes.test.cjs','scripts/inject-version.js',
  'api/analyze.js','api/gmail/pilot-auth.js','secrets.env'
];

test('Vercel builds explicit public assets rather than exposing repository internals',()=>{
  assert.equal(config.version,2);
  assert.equal(config.buildCommand,
    'node scripts/inject-version.js && node scripts/build-static.js');
  assert.equal(config.outputDirectory,'public');
  assert.ok(!Object.hasOwn(config,'routes'));
  assert.ok(!Object.hasOwn(config,'rewrites'));
});

test('Vercel header rules use validated path matcher and do not cache HTML or OAuth',()=>{
  assert.deepEqual(config.headers.map(h=>h.source),['/(.*)']);
  assert.ok(config.headers[0].headers.some(h=>
    h.key==='Cache-Control'&&h.value.includes('no-store')));
  assert.ok(config.headers[0].headers.some(h=>
    h.key==='CDN-Cache-Control'&&h.value==='no-store'));
});

test('static packaging copies precisely the public allowlist and fails closed',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexlupa-static-build-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const script=path.join(root,'scripts','build-static.js');
  fs.mkdirSync(path.dirname(script),{recursive:true});
  fs.writeFileSync(script,builder);
  for(const file of [...expected,...forbidden]){
    const full=path.join(root,file);
    fs.mkdirSync(path.dirname(full),{recursive:true});
    fs.writeFileSync(full,'fixture');
  }
  const run=()=>execFileSync(process.execPath,[script],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']
  });
  assert.match(run(),/copied 14 allowlisted assets/);
  for(const file of expected)
    assert.equal(fs.readFileSync(path.join(root,'public',file),'utf8'),'fixture');
  for(const file of forbidden)
    assert.equal(fs.existsSync(path.join(root,'public',file)),false,
      'private file must not be copied: '+file);
  fs.rmSync(path.join(root,'app','script.js'));
  assert.throws(()=>run(),/Missing required public asset: app\/script\.js/);
});
