'use strict';
// Static contract checks for the FREE screen: not a substitute for real browser QA.
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','app','script.js'),'utf8');
test('FREE displays all actions, never slices to three',()=>{
  assert.doesNotMatch(source,/accions\s*=\s*accions\.slice\(0,\s*3\)/);
  assert.match(source,/accions\s*=\s*applyPriorityHeuristics\(accions\)/);
});
test('FREE retains task end date and expired marker from API',()=>{
  assert.match(source,/dataFi:\s*a\.dataFi\s*\|\|\s*null/);
  assert.match(source,/vençut:\s*!!a\.vençut/);
  assert.match(source,/Termini vençut/);
  assert.match(source,/Fins:\s*'/);
});
test('FREE does not discard all events after the first',()=>{
  assert.match(source,/esdeveniments\.forEach\(function\(e\)/);
});
