# NEXLUPA Agent — Fase 2: extracció i preguntes amb IA, prototip intern
Data: 2026-11-07
Estat: codi experimental a GitHub, **sense web, sense desplegament, sense serveis reals i sense canvis a producció**.
Branca: `product/whatsapp-premium-20261107` · PR #4 (draft)

## Què hem afegit
1. `lib/premium-ai-extractor.js`: integració preparada per a un client OpenAI injected; petició `chat.completions.create` amb **Structured Outputs JSON Schema estricte**. Extreu inici, arribada, lloc, material i terminis. Rebutja dades sense fragment literal de font, dates impossibles i horaris incoherents amb `Europe/Madrid`. Correccions i missatges dubtosos es retenen. La certesa del model no equival a probabilitat estadística.
2. `lib/premium-agent-pipeline.js`: passa una comunicació autoritzada per l'extractor i reconcilia la fitxa de l'activitat. Descarta missatges fora de l'activitat, no cobra trucades de model per duplicats, separa dades segures de propostes a revisar i només prepara canvis de Calendar.
3. `lib/premium-ai-answerer.js`: el model només classifica **què pregunta l'usuari**, no escriu la resposta factual. La resposta es construeix en codi a partir de les dades de la fitxa i **fonts exactes**. Si falta prova de pagament o la dada és incerta, diu que no ho sap. Permet consultar hora d'arribada, inici, material, lloc, termini, canvis i Calendar (indicant que Calendar real no està verificat).
4. `tests/fixtures/premium-ai-eval-challenge.json`: **20 comunicacions fictícies de repte**, algunes en castellà i anglès, amb casos ambigus, rectificacions, cancel·lacions i una instrucció maliciosa incrustada al missatge. Les etiquetes són provisionals fins a revisió independent.
5. `scripts/eval-premium-ai.js`: avaluador de model **opt-in**. Per defecte fa un dry-run sense API i sense cost. Una prova real requereix `RUN_LIVE_AGENT_EVAL=YES` i `OPENAI_API_KEY` autoritzada. Mai publica dades ni toca Gmail, WhatsApp o Calendar.
6. `scripts/run-premium-prototype-tests.js`: executor manual de 5 suites de regressió amb Node.js.

## Proves completades
Les **cinc suites de regressió** han passat a l'entorn de JavaScript d'orquestració amb els fitxers actualment guardats a GitHub:
- `tests/run-activity-sync.js`
- `tests/run-premium-agent-pilot.js`
- `tests/run-premium-natural-intake.js`
- `tests/run-premium-ai-extractor.js`
- `tests/run-premium-ai-answerer.js`

Proves de seguretat i qualitat que s'han cobert:
- No incorporar fets amb fonts inexistents; controlar dates, zona horària i missatges de grups no autoritzats.
- No confondre «últim dia per pagar» amb «ja està pagat».
- No modificar calendaris realment i no enviar missatges a tercers; els canvis dubtosos queden en revisió.
- No generar resposta a partir de text lliure inventat pel model; només de fets estructurats amb procedència.
- Gestionar errors, recusacions, sortides truncades i JSON invàlid de manera segura.
- El test del connector multicanal utilitza models simulats i cap compte real.

**Aclariment crític:** NO s'ha executat cap petició a un model d'IA real, ja que les credencials no s'han facilitat a l'entorn de proves i l'usuari ha exclòs intervenir a la web/producció. Les proves de l'adaptador fan servir clients simulats. Les 20 comunicacions de repte només tenen verificat el funcionament del marc d'avaluació, **no** precisió del model.

## Limitacions actuals
- La reconciliació de fitxes encara és experimental i se centra en un únic esdeveniment. Cal ampliar-la a múltiples actes i fonts intercalades sense confondre activitat/termini.
- El model d'IA real pot cometre errors d'extracció, context i assignació de dates; cal mesurar-los amb un conjunt cec revisat i amb aprovació del cost.
- No hi ha autenticació multiusuari, base de dades de famílies, OAuth Gmail/Calendar ni entrada WhatsApp connectada.
- Les notificacions de WhatsApp Android només serien una via parcial i consentida, no lectura completa de grups privats.
- Cal dissenyar emmagatzematge xifrat, retenció mínima, esborrat, control d'accessos i tractament de dades de menors abans d'una beta.
- Els fluxos de Calendar són propostes (dry run); els permisos, idempotència contra duplicats i rollback real no estan implementats.
- No hem fet proves E2E amb Node+OpenAI real i no s'ha executat GitHub CI per aquests canvis; s'han comprovat les suites en un entorn de JavaScript compatible en memòria.

## Properes fites ordenades
1. **Avaluació amb model d'IA real en entorn segregat**, utilitzant només missatges ficticis, secrets autoritzats i pressupost acotat; comparar amb els resultats esperats, corregir falsos positius i falsos negatius.
2. **Índex multiesdeveniment** i consultes conversacionals amb context d'activitat, dates i fonts diferents.
3. **Persistència segura i permisos de família**; després lectura Gmail Premium autoritzada amb OAuth.
4. **Google Calendar Premium**, primer comprovació/dry-run i posteriorment escriptura confirmada sense duplicats.
5. **WhatsApp**, prova de la millor entrada viable i consentida, mesurant cobertura i passos humans; no prometre lectura passiva total.
6. Beta consentida i mesurament del temps estalviat; no tocar la web fins a una instrucció expressa.

## Pla comercial preservat
Free: 3 lectures manuals/dia. Premium: lectures il·limitades amb ús raonable, Gmail i Google Calendar, agent de prova limitat. Nivell Agent (nom provisional): més autonomia i ús ampli. No hi ha nous preus ni canvis comercials publicats.
