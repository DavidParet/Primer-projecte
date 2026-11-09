'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {scanText} = require('../scripts/security/check-tracked-credentials');
test('detects long synthetic Vercel-format credential without displaying value',()=>{
  const sample='vca_'+'Q'.repeat(40);
  assert.deepEqual(scanText('authorization: bearer '+sample),[
    'Vercel-like personal access token'
  ]);
});
test('does not reject placeholder, pattern literals or unrelated text',()=>{
  for(const value of ['vca_REDACTED','vca_[A-Za-z0-9_-]{24,}',
    'no tokens committed', 'vca_short','']) {
    assert.deepEqual(scanText(value),[]);
  }
});
