'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=path.join(__dirname,'..');
test('QA runner rejects redirects and refuses non-preview targets',()=>{
  const source=fs.readFileSync(path.join(__dirname,'run-qa.js'),'utf8');
  assert.match(source,/redirect:'manual'/);
  assert.match(source,/preview NexLupa no reconeguda/);
  assert.match(source,/Data QA no acceptada/);
  assert.match(source,/os\.tmpdir/);
});
test('QA scorer never claims a score for original natural-language expected rubric',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nx-qa-review-'));
  try{
    const cases=path.join(temp,'cases.json'),results=path.join(temp,'result.json');
    fs.writeFileSync(cases,JSON.stringify([{id:1,message:'Missatge fictici',esperat:'Cal identificar el partit.'}]));
    fs.writeFileSync(results,JSON.stringify({results:[{id:1,status:200,resultat:{resum:'Partit',accions:[],esdeveniments:[]}}]}));
    const res=spawnSync(process.execPath,[path.join(base,'tests','grade-qa.js'),cases,results],{encoding:'utf8'});
    assert.equal(res.status,0,res.stderr);
    assert.match(res.stdout,/REVISIÓ_MANUAL/);
    assert.match(res.stdout,/REVISIO_MANUAL 1 de 1/);
    assert.doesNotMatch(res.stdout,/PASS_AUTO 1/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
