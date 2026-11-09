'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const config=JSON.parse(readFileSync(resolve(__dirname,'../vercel.json'),'utf8'));
const expected=['html','css','js','png','jpg','jpeg','webp','svg','ico','gif'];

test('all header patterns use documented path-to-regexp compatible extension syntax',()=>{
  assert.deepEqual(config.headers.map(h=>h.source),expected.map(ext=>'/(.*).'+ext));
  assert.ok(config.headers.every(h=>!h.source.includes('\\')));
  assert.ok(config.headers.every(h=>Array.isArray(h.headers)&&h.headers.length>0));
});
test('HTML is never cached across pilot callbacks',()=>{
  const html=config.headers.find(h=>h.source==='/(.*).html');
  assert.ok(html.headers.some(h=>h.key==='Cache-Control'&&/no-store/.test(h.value)));
});
test('CSS and JS retain immutable public asset caching',()=>{
  for(const ext of ['css','js']){
    const rule=config.headers.find(h=>h.source==='/(.*).'+ext);
    assert.ok(rule.headers.some(h=>h.key==='Cache-Control'&&h.value==='public, max-age=31536000, immutable'));
  }
});
test('image extension rules retain the previous one-day cache policy',()=>{
  for(const ext of ['png','jpg','jpeg','webp','svg','ico','gif']){
    const rule=config.headers.find(h=>h.source==='/(.*).'+ext);
    assert.ok(rule.headers.some(h=>h.key==='Cache-Control'&&h.value==='public, max-age=86400'));
  }
});
test('Vercel still builds using the original unchanged app build command',()=>{
  assert.equal(config.version,2);
  assert.equal(config.buildCommand,'node scripts/inject-version.js');
  assert.equal(config.outputDirectory,undefined);
});
