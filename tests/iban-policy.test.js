'use strict';
// Protecció de l'usuari davant números de compte bancari mal copiats.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractUseful, normalizeAnalysis, ibanValid } = require('../lib/nexlupa-result');

const BAD = 'ES12 1234 5678 9012 3456 7890';
const GOOD = 'ES91 2100 0418 4502 0005 1332';

test('un IBAN invàlid es mostra literalment, però no entra a la llista d’IBAN vàlids', () => {
  const s = 'Colònies: cal pagar 125 € al compte ' + BAD + '.';
  const x = extractUseful(s, { iban: [BAD] });
  assert.equal(ibanValid(BAD), false);
  assert.deepEqual(x.iban, []);
  assert.deepEqual(x.ibanInvalids, [BAD]);
  assert.match(x.avisos.join(' '), /Confirma’l amb l’emissor abans de fer cap transferència/);
  assert.match(x.avisos.join(' '), /No utilitzis aquest número per pagar/);
});

test('l’IBAN vàlid continua a iban sense advertiments de pagament', () => {
  const x = extractUseful('Compte ' + GOOD + ' per la reserva.', {});
  assert.equal(ibanValid(GOOD), true);
  assert.deepEqual(x.iban, [GOOD]);
  assert.deepEqual(x.ibanInvalids, []);
  assert.equal(x.avisos, undefined);
});

test('un IBAN inventat per la IA no es mostra si no consta a la font', () => {
  const x = extractUseful('Pagar 125 €', { iban: [BAD] });
  assert.deepEqual(x.ibanInvalids, []);
  assert.deepEqual(x.iban, []);
});

test('un IBAN invàlid llegit d’una imatge es mostra com a no verificat', () => {
  const x = extractUseful('', { iban: [BAD] }, { fromImage: true });
  assert.deepEqual(x.iban, []);
  assert.deepEqual(x.ibanInvalids, [BAD]);
  assert.equal(x.origenImatge, true);
});

test('la normalització manté separats el compte invàlid i les accions', () => {
  const x = normalizeAnalysis({resum:'Colònies',decisio:'Cal pagar',
    accions:[{accio:'Pagar 125 € abans del 30 de novembre',tipus:'tasca'}]},
    'Colònies: cal pagar 125 € abans del 30 de novembre. IBAN: ' + BAD,
    '2026-11-12');
  assert.equal(x.accions.length, 1);
  assert.deepEqual(x.dadesUtils.ibanInvalids, [BAD]);
  assert.deepEqual(x.dadesUtils.iban, []);
});

test('la interfície mostra l’avís i no ofereix un enllaç de pagament per IBAN invàlid', () => {
  const script = fs.readFileSync(path.join(__dirname,'../app/script.js'),'utf8');
  assert.match(script, /\['ibanInvalids','IBAN no vàlid · no utilitzar per pagar'\]/);
  assert.match(script, /\['ibanInvalids','IBAN NO VÀLID \(no utilitzar per pagar\)'\]/);
  assert.match(script, /if \(group\[0\] === 'enllacos'/);
});
