'use strict';
// Avaluador mecànic per a llistes amb «esperat.esdeveniments/tasques/dadesUtils» (qa20). No substitueix la revisió manual.
// Ús: node tests/grade-qa.js cases.private.json qa-result-AAAA-MM-DD.json
const fs = require('fs');
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const res = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).results;
const byId = Object.fromEntries(res.map(r => [r.id, r]));
const rank = { alta: 0, mitja: 1, baixa: 2 };
let pass = 0, warn = 0, fail = 0, err = 0, needsReview = 0;
for (const c of cases) {
  const r = byId[c.id];
  if (!r || r.error) { err++; console.log(c.id + '\tERROR\t' + ((r && r.error) || 'sense resultat')); continue; }
  const d = r.resultat || {}, e = c.esperat, greus = [], menors = [];
  if (!e || typeof e !== 'object' ||
      !Array.isArray(e.esdeveniments) || !Array.isArray(e.tasques)) {
    needsReview++;
    console.log(c.id+'\tREVISIÓ_MANUAL\tExpectativa en llenguatge natural: el resultat real ha de ser valorat per Claude.');
    continue;
  }
  const evs = (d.esdeveniments || []).filter(x => x && x.data);
  for (const x of e.esdeveniments) {
    if (!x.d) { if (evs.some(v => new RegExp(x.t, 'i').test(v.title || ''))) greus.push('esdeveniment exportable amb data incoherent: ' + x.t); continue; }
    const hit = evs.find(v => v.data.slice(0, 10) === x.d && (!x.h || v.data.includes(x.h)));
    if (!hit) greus.push('falta ' + x.t + ' ' + x.d + ' ' + (x.h || ''));
  }
  for (const t of e.tasques) {
    const all = [...(d.accions || [])];
    const a = all.find(v => new RegExp(t.kw, 'i').test(v.accio || ''));
    if (!a) { menors.push('tasca absent: ' + t.kw); continue; }
    if (!t.p.split('|').includes(a.prioritat)) {
      (/alta/.test(t.p) && /pag|autoritz|inscri|matricul/i.test(t.kw + a.accio) ? greus : menors).push('prioritat ' + a.prioritat + ' ≠ ' + t.p + ' (' + t.kw + ')');
    }
    if (t.d && a.data && a.data.slice(0, 10) !== t.d) greus.push('termini ' + a.data + ' ≠ ' + t.d + ' (' + t.kw + ')');
  }
  const du = d.dadesUtils || {}, flat = JSON.stringify(du).replace(/\s+/g, '').toLowerCase();
  for (const [k, arr] of Object.entries(e.dadesUtils || {})) for (const v of arr) {
    if (!flat.includes(v.replace(/\s+/g, '').toLowerCase().replace(/^https:\/\//, ''))) greus.push('dada útil absent/alterada: ' + k + ' ' + v);
  }
  const status = greus.length ? 'FAIL' : menors.length ? 'WARN' : 'PASS';
  if (status === 'PASS') pass++; else if (status === 'WARN') warn++; else fail++;
  console.log(c.id + '\t' + status + '\t' + greus.concat(menors).join(' | '));
}
console.log('\nPASS_AUTO', pass, 'WARN_AUTO', warn, 'FAIL_AUTO', fail, 'ERROR', err, 'REVISIO_MANUAL', needsReview, 'de', cases.length,
  '— mecànic; cal revisió manual (injecció, invenció, semàntica) abans de donar xifres finals.');
