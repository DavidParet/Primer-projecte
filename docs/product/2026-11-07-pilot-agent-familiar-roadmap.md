# NEXLUPA — Pilot d'agent familiar, pla d'execució
Data: 2026-11-07
Estat: Full de ruta aprovat conceptualment; no implementat en producció
Restricció explícita: **NO tocar web, landing, preus públics, branca main ni producció.**
Treballar només a la branca de producte/prototip amb proves sintètiques i prototips interns.

## Decisió comercial acordada
- **Free:** 3 lectures/anàlisis manuals al dia, d'acord amb el model Free actual.
- **Premium:** lectures il·limitades amb ús raonable, Gmail i Google Calendar connectables, fitxes, agent amb prova/consultes limitades.
- **Nivell Agent** (nom pendent): lectures il·limitades amb ús raonable i agent d'ús ampli i proactiu, màxima automatització legal i tècnica de WhatsApp; **Gmail/Calendar no són exclusius del pla Agent**.
- La diferència del nivell Agent és l'autonomia, no només la quantitat de preguntes.
- No fixar encara preus ni prometre WhatsApp 100% passiu.

## Escenari pilot més petit que té sentit
**Una família consentidora, una extraescolar (p. ex. Ball), dues fonts (Gmail oficial + WhatsApp informal) i Google Calendar.**

La pregunta de valor és: «Quin era l'últim dia per pagar?». També:
- «A quina hora comença el festival?»
- «A quina hora hi hem d'arribar?»
- «Què s'ha de portar?»
- «Han canviat l'horari?»
- «Ho tenim apuntat al calendari?»
- «Ja ho hem pagat?» — NO afirmar-ho sense comprovant.

## Fases i ordre
### 0 — Fet: simulació de lògica (NO integracions)
- Motor experimental `lib/premium-agent-pilot.js` que rep interpretacions ja estructurades.
- Fixture `tests/fixtures/premium-agent-ball.json`, amb comunicacions fictícies Gmail + WhatsApp, preguntes i proposta de canvi a Calendar.
- Test `tests/run-premium-agent-pilot.js`; les proves actuals validen fusió, fonts, contradiccions i preguntes simples.
- Límits: la prova no mesura qualitat d'extracció real de la IA, cobertura WhatsApp ni accés real a OAuth i Calendar.

### 1 — Següent construcció: experiència «Pregunta a NEXLUPA»
- Agent que consulta fitxa i fonts autoritzades; recuperació de cites del missatge original, date-time normalitzat, suport a consultes conversacionals i seguiments.
- Integrar una capa d'extracció IA amb proves cegues per missatges ficticis no preestructurats, sense exposar cap dada de famílies.
- Metadades de prova: exactitud de terminis i horaris, nombre de respostes correctes amb font, dubtes ben detectats i temps de resposta.
- **Criteri de pas:** cap invenció de terminis; no confondre hora d'arribada amb inici; no afirmar «pagat» sense evidència.

### 2 — Pilot de canals autoritzats i fitxa viva
- Gmail: connectar via OAuth amb permisos mínims; identificar només correus pertinents d'una activitat voluntàriament seleccionada.
- WhatsApp: començar per reenviament autoritzat al canal de recepció oficial quan estigui configurat; alternativament, compartir manualment una còpia sense dades personals per test.
- Convergència: correu oficial i WhatsApp informal alimenten **la mateixa** activitat, amb font i hora de cada canvi.
- No crear un registre de documents de menors a GitHub: només fixtures sintètics o anonimitzats aprovats.
- **Criteri de pas:** cap duplicitat, fonts sempre visibles, conflictes a revisió.

### 3 — Google Calendar real
- OAuth de Calendar Premium, flux segur de crear/modificar esdeveniments, identificació persistent i control d'idempotència.
- Primer executar dry-run i confirmació explícita; no activar modificació automàtica sense permisos granulars.
- **Criteri de pas:** un canvi d'entrenament modifica exactament un esdeveniment existent; reversió i registre de modificacions disponibles.

### 4 — Atacar el coll d'ampolla de WhatsApp
- Investigar Android natiu i permisos revocables de notificacions únicament dels grups seleccionats; mesurar missatges perduts/ocults/silenciats, integritat, privacitat i requisits d'Android/WhatsApp/Google Play.
- Alternatives: reenviament fàcil al WhatsApp oficial de NEXLUPA, compartir a NEXLUPA i convenis amb entitats emissores.
- **Criteri de pas:** cobertura mesurada en un dispositiu real; mai anunciar lectura integral de grups privats sense suport verificat.

### 5 — Oferta comercial i beta
- Comparar temps estalviat versus gestió manual, fiabilitat, costos d'IA per consulta, costos de canals, retenció i confiança.
- Dissenyar quotes d'agent limitades a Premium i ús ampli amb límit raonable al pla Agent.
- Definir nom i preu només després de la prova de valor. No modificar la web fins a petició expressa.

## KPI de pilot
1. **Cobertura** = comunicacions realment rebudes / comunicacions pertinents verificades.
2. **Resposta correcta amb font** = preguntes resoltes correctament amb missatge d'origen.
3. **Automatització segura** = gestions correctament preparades/aplicades sense duplicats ni canvis indeguts.
4. **Estalvi** = passes manuals evitades i minuts estalviats per família.
5. **Risc** = falsos positius de Calendar, dates inventades, misses crítics, contingut de tercers exposat.
6. **Cost** = cost variable d'IA i dels canals per família i mes.

## No fer
- No accedir a WhatsApp d'un altre usuari ni a grups privats amb mètodes no oficials.
- No fer servir un test sintètic per afirmar que ja existeix un producte operatiu.
- No publicar dades personals, correus reals o comunicacions escolars a GitHub.
- No desplegar ni publicar cap canvi comercial fins que l'usuari ho indiqui.

## Proper lliurable tècnic
**Agent de preguntes que recupera fonts i identifica terminis/horaris amb missatges ficticis en llenguatge natural, no amb interpretacions artificials ja emplenades.**
Aquest és el pont entre els tests de lògica actuals i una beta real amb Gmail, WhatsApp i Calendar.
