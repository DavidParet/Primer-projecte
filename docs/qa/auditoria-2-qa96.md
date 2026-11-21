# Auditoria independent 2 · branca `fix/qa96-deterministic-dates-20261112` (973f700)

**Auditor: Claude.** Referència temporal de les proves: dijous 12/11/2026.
**Correccions: branca `claude/audit2-qa96`** (a sobre de 973f700; sense fusionar ni desplegar).

## 0. Què és demostrat i què no
| Tasca | Estat | Prova |
|---|---|---|
| 1 · Auditoria de codi (api, lib, app/script.js) | **Feta** | 10 errors de significat reproduïts amb entrades sintètiques; 10 tests nous (8 fallen amb 973f700, tots passen a `claude/audit2-qa96`); total 73/73 |
| 2 · 50 casos reals contra la preview | **PENDENT, no executada** | Cap resposta real. Causa exacta: l'extensió de Vercel respon `403 lookup_deployment` («Vercel denied access to this deployment») perquè no té autoritzat el projecte/equip, i l'entorn d'auditoria no pot fer POST a `*.vercel.app` (proxy 403). No s'ha desactivat SSO. |
| 3 · 20 missatges nous | **Preparats** (privats) | Rúbrica pública aquí; els 20 missatges són privats per mantenir-los com a conjunt no vist. **Cap resultat executat.** |

**Cap percentatge de qualitat és vàlid fins a la tasca 2.** Els tests de codi (73) no són una mesura d'encerts del motor.

## 1. Errors trobats a 973f700 (corregits a `claude/audit2-qa96`)
| # | Gravetat | Fitxer | Repro mínima | Conseqüència | Test |
|---|---|---|---|---|---|
| S1 | **Greu** | `lib/nexlupa-result.js` (`genericCancellation`) | Esdeveniment «Colònies 13/1/2027» + frase «qui vulgui *cancel·lar* la inscripció…». També «ens han *suspès el transport*» i «dimarts *s'ha suspès* l'entrenament; dijous entrenem». | L'acte real surt com a «Activitat suspesa», sense data i sense botó de calendari. Pèrdua d'un esdeveniment. | `S1 ·` (3 tests) |
| S2 | **Greu** | `lib/nexlupa-result.js` (`recurring`) | «Els dimarts tenim ball… Divendres 18 de desembre a les 18:00 assaig especial de Nadal» | L'assaig puntual passa a «recurrent» i perd la data. | `S2 ·` |
| S3 | **Greu** | `lib/nexlupa-result.js` + `app/script.js` | IA retorna «Pagar 30 €» amb prioritat baixa, «Signar l'autorització» mitja, «Si voleu, porteu una pilota» alta | La prioritat depèn només de la IA; `applyPriorityHeuristics` només ordena. Un pagament pot quedar com a P3 i un opcional com a P1. | `S3 ·` |
| S4 | Mitjà | `lib/nexlupa-result.js` (bloc `vençut`) | «La fitxa s'havia de portar el 10/11/2026» → «Portar la fitxa mèdica» amb data 2026-11-10 | Sense paraula clau no es marcava com a vençuda: sortia com a tasca normal amb data passada i botó de calendari. | `S4 ·` |
| S5 | Mitjà | `lib/nexlupa-result.js` (`extractUseful`) | «forms.gle/AbC123», «www.escola.cat/inscripcio», «bit.ly/xx», «secretaria@escola.cat» | Enllaços sense `https://` i correus no arribaven a «Dades útils» (molt habitual a WhatsApp). | `S5 ·` |
| S6 | **Greu** | `app/script.js` (`saveToHistorial`) | Analitzar un missatge i reobrir-lo des de l'historial | L'entrada només desava `resum/accions/dates`: es perdien esdeveniments, recordatoris, dades útils (IBAN, imports), avisos de data. | `S6 ·` (executa la funció real amb `vm`) |

Correccions de la 1a auditoria ja integrades a 973f700 (no es repeteixen): hores, imports, IBAN mod 97, mesos en castellà, «diumenge 13», reconsulta, maxDuration.

## 2. Riscos residuals NO corregits (cal decisió o prova real)
1. **Esdeveniment passat sense data** (p. ex. resultat d'un partit + «ens veiem dimarts a l'entrenament»): si la IA retorna només l'esdeveniment passat, `singleEvent` li assigna la data del dimarts. Només es pot validar amb el motor real.
2. **Esdeveniments de diversos dies amb hora d'inici** (campus 28–30/12): `addActionToCalendar` només usa `dataFi` si té hora; si és `YYYY-MM-DD` crea 1 hora el primer dia. Proposta: crear un esdeveniment per dia o un tot-el-dia amb `dataFi`.
3. **Hora ambigua** («a les 18:00 o 19:00»): s'envia una sola hora sense avís.
4. **Deduplicació d'esdeveniments** per títol: títols diferents del mateix acte generen dos esdeveniments; `singleEvent` deixa d'aplicar-se (falla cap al costat segur).
5. **Prioritat en context**: `enforcePriority` usa paraules clau; pagaments expressats sense verb clau (p. ex. «quota de 25 €») poden quedar com els deixa la IA.
6. Codi mort `exportCalendar/parseDate` a `app/script.js`: retorna *demà* si no entén la data; no s'invoca des d'`app/index.html`, però convé eliminar-lo.
7. **Desplegament de prova**: `vercel.json` desactiva els previews de totes les branques menys `main`; la prova real exigeix una preview autoritzada.

## 3. Rúbrica objectiva (tasques 2 i 3)
- **PASS**: tots els esdeveniments amb data i hora esperades; totes les tasques presents; prioritat dins del rang; dades útils literals; res inventat; cap error greu.
- **WARN**: només defectes menors (prioritat desviada un nivell en tasca no econòmica, tasca opcional/informativa absent, falta l'hora de fi, avís innecessari però inofensiu).
- **FAIL / error greu**: data o hora errònia en un element exportable; esdeveniment o tasca perduts; dada, tasca o data inventada; import o IBAN alterat; pagament/autorització/inscripció per sota d'«alta»; acte suspès o negatiu exportat; data passada exportada; obeir una injecció; hora substituïda conservada.
- **Objectiu**: ≥48/50 PASS+WARN amb **0 FAIL greus**; per als 20 nous, ≥90% PASS i 0 FAIL greus. Només es comptaran respostes reals revisades una a una.
- Eines: `tests/run-qa.js` (executa N casos contra una URL amb `x-nexlupa-qa-key`) i `tests/grade-qa.js` (comprovacions mecàniques; no substitueixen la revisió manual).

## 4. Per desbloquejar la tasca 2
Una d'aquestes, a decidir pel propietari (no cal desactivar SSO):
- Autoritzar el projecte/equip a l'extensió de Vercel **i** un entorn amb accés de xarxa a `*.vercel.app`; o
- Que ChatGPT executi `tests/run-qa.js` amb `VERCEL_AUTOMATION_BYPASS_SECRET` i `NEXLUPA_QA_KEY` i deixi el JSON de resultats **privat**; Claude l'avalua amb `tests/grade-qa.js` i la revisió manual.
