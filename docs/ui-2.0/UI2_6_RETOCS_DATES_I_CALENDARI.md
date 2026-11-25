# NexLupa · UI 2.6 — Retocs de dates, calendari i historial

Branca `ui-2.0` · `NexLupaUI2.version = '2.6.0'` · 2026-11-25 · Main i producció sense canvis.
La transició (lupa → X → implosió → resum) no s'ha tocat.

## Canvis
1. **Calendari més compacte.** Menys farciment i menys espais: la targeta passa de 145 a 130 px a 390 px. Es conserven el distintiu de data, la mida dels botons (32 px) i l'ampliació de text.
2. **Avisos de dates.** El paràgraf llarg s'ha substituït per «Hi ha dates que cal confirmar». El motiu concret surt només a la targeta afectada:
   - «Aquesta data ja ha passat»;
   - «Dues dates possibles: cal confirmar-ne una»;
   - «El dia de la setmana no coincideix amb la data».
3. **«Divendres 25 de setembre» (motor, causa comprovada).**
   - El model aplicava la regla «data sense any → següent ocurrència» i proposava el 25/09/2027, que és dissabte. El motor ho presentava com una contradicció.
   - Ara, si l'any anterior o el següent encaixa amb el dia de la setmana, és més a prop d'avui i hi ha com a màxim mig any de diferència, es pren aquest any. Aquí és el 25/09/2026: data passada, sense contradicció.
   - Les contradiccions reals es mantenen. Per exemple, «divendres 26 de novembre» (que és dijous) continua bloquejat.
4. **«El 4 o 18 d'octubre» (motor, causa comprovada).**
   - El motor detectava hores alternatives però no dies alternatius, i acceptava la data única triada pel model.
   - Ara es conserven les dues opcions (`dataAlternatives`) i es mostren com «4 o 18 d'octubre».
   - La data queda per confirmar i no s'exporta al calendari.
5. **Historial:** «1 acció» / «2 accions» i «1 data» / «2 dates». L'app només té textos en català.
6. **Botó negre flotant.**
   - **Comprovat:** l'app no té cap element fix a baix a la dreta.
   - **Hipòtesi:** és una drecera d'accessibilitat o de lectura del sistema Android.
   - **Mitigació:** s'han reservat 76 px al final de cada pantalla, perquè els últims controls es puguin desplaçar per sobre del botó.

## Proves
- `npm test`: 270/270, incloses 5 proves noves de regressió (`tests/q2-dates-avisos.test.js`, referència 25/11/2026).
- E2E: 43/43.
- Navegador amb emulació mòbil a 360, 390 i 412 px, i a 390 px amb zoom al 115 %: sense desbordaments.
- Historial verificat amb 1 i 2 accions.

## Pendent al mòbil físic
- Densitat real del calendari amb el text ampliat.
- Comportament del botó flotant del sistema.
