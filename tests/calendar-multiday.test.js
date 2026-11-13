'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/script.js'), 'utf8');
const fn = source.match(/^function addActionToCalendar\([^]*?^\}/m);
assert.ok(fn, 'calendar function must exist');
function check(a) {
  let opened = [], warnings = [];
  const ctx = { Date, URLSearchParams, _lastData: null, alert: x => warnings.push(x),
    document: { createElement: () => ({click(){opened.push(this.href)}}), body:{appendChild(){},removeChild(){}} } };
  vm.createContext(ctx); vm.runInContext(fn[0], ctx); ctx.addActionToCalendar(a);
  return {opened,warnings};
}
test('multi-day timed start with date-only end cannot silently export one hour', () => {
  const r = check({accio:'Campus',data:'2026-12-28 09:00',dataFi:'2026-12-30'});
  assert.equal(r.opened.length,0); assert.equal(r.warnings.length,1);
});
test('single-day timed event can still export provisional one hour', () => {
  const r = check({accio:'Reunió',data:'2026-12-28 09:00'});
  assert.equal(r.opened.length,1); assert.match(decodeURIComponent(r.opened[0]),/20261228T090000\/20261228T100000/);
});
test('multi-day timed event with explicit end time preserves whole interval', () => {
  const r = check({accio:'Campus',data:'2026-12-28 09:00',dataFi:'2026-12-30 17:00'});
  assert.equal(r.opened.length,1); assert.match(decodeURIComponent(r.opened[0]),/20261228T090000\/20261230T170000/);
});
