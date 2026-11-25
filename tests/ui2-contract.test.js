'use strict';
// UI 2.0: la capa visual ha de ser independent del motor QA96 i de les dades.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const ui2js = fs.readFileSync(path.join(root, 'app/ui2.js'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts/build-static.js'), 'utf8');

test('UI2: ui2.css es carrega després de style.css i ui2.js després de script.js', () => {
  assert.ok(html.indexOf('ui2.css') > html.indexOf('style.css'));
  assert.ok(html.indexOf('ui2.js') > html.indexOf('script.js'));
  assert.match(html, /<body class="ui2">/);
});
test('UI2: el build estàtic publica tots els recursos UI 2.0 i existeixen', () => {
  for (const f of ['app/ui2.css', 'app/ui2.js', 'app/assets/ui2-lupa.png', 'app/assets/ui2-logo.png']) {
    assert.ok(build.includes("'" + f + "'"), f + ' a build-static');
    assert.ok(fs.existsSync(path.join(root, f)), f + ' existeix');
  }
});
test('UI2: la capa visual no fa crides de xarxa ni toca dades desades', () => {
  assert.doesNotMatch(ui2js, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/);
});
test('UI2: no redefineix cap funció del motor ni de render', () => {
  const fns = ['analyze', 'render', 'renderResult', 'applyPriorityHeuristics', 'categorizeAccions', 'buildActionCard',
    'buildEventCard', 'formatActionDate', 'addActionToCalendar', 'saveToHistorial', 'renderTasques', 'navTo', 'checkLimit'];
  for (const f of fns) {
    assert.doesNotMatch(ui2js, new RegExp('(window\\.|\\b)' + f + '\\s*=(?!=)'), f + ' no es reassigna');
    assert.doesNotMatch(ui2js, new RegExp('function\\s+' + f + '\\s*\\('), f + ' no es redeclara');
  }
});
test('UI2: sense rètols de depuració visibles a l’app', () => {
  assert.doesNotMatch(html, /BUILD MOBILE POLISH OK|BUILD 2026-06-01/);
});
test('UI2: es conserven els IDs que fa servir el motor', () => {
  for (const id of ['txt', 'btnAnalyze', 'loading', 'results', 'nx-p1-content', 'nx-p2-content', 'nx-info-content',
    'nx-more-actions-toggle', 'nx-more-actions-content', 'nx-decisio', 'tasquesList', 'errMsg']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
});
test('UI2.1: reversible — no s’autoactiva, admet ?ui2=off i disable()', () => {
  assert.doesNotMatch(ui2js, /classList\.add\(\s*['"]ui2['"]\s*\)/);
  assert.match(ui2js, /ui2=off/);
  assert.match(ui2js, /disable:\s*disable/);
});
test('UI2.1: l’indicador original només s’amaga mentre la capa animada és activa', () => {
  const css = fs.readFileSync(path.join(root, 'app/ui2.css'), 'utf8');
  assert.doesNotMatch(css, /body\.ui2 \.loading\.on \{ display: none/);
  assert.match(css, /body\.ui2\.ui2-scanning \.loading\.on \{ display: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
