# NEXLUPA Agent — resultat del primer pilot de 20 comunicacions
**Data:** 2026-11-07
**Estat:** prova local/sintètica superada; NO desplegada i NO connectada a serveis reals.
**Branca GitHub:** `product/whatsapp-premium-20261107`
**Restricció aplicada:** no s'ha modificat la web, landing, tarifes, branca principal ni producció.

## Objectiu original
Una família, una extraescolar (Ball), dos canals (Gmail formal + WhatsApp informal), fitxa única i Google Calendar. L'usuari ha de poder preguntar com ho faria a un altre pare: «Quin era l'últim dia per pagar?», «A quina hora hem d'arribar?», «Ja està pagat?».

## Què s'ha executat
1. **20 missatges ficticis no preestructurats**, en llenguatge natural, amb avís formal de festival, canvi de data/hora, termini de pagament, material, recordatoris, missatges trivials, un missatge d'un altre grup, un duplicat i un avís relatiu a una sortida diferent.
2. **Extractor de regles en català** que converteix alguns d'aquests textos en dades estructurades i vinculades a una font. No és un model d'IA; és una base de regressió, no una solució generalitzable.
3. **Conciliació** en una mateixa fitxa de Ball: deduplicació, rastre de fonts Gmail/WhatsApp, mateix identificador d'esdeveniment, detecció de contradiccions i revisió de casos incerts.
4. **Agent bàsic de preguntes** amb fonts, dates llegibles i declaració explícita quan una dada no es pot confirmar.
5. **Google Calendar: només proposta** d'actualitzar un esdeveniment fictici existent; cap OAuth, cap API de Calendar, cap escriptura real.
6. **Tres suites de regressió** comprovades sobre el codi actual de la branca mitjançant execució de JavaScript en un entorn CommonJS simulat: test inicial de 8 missatges, pilot multicanal amb 7 missatges i pilot de 20 missatges.

## Resultats verificats del conjunt fictici
| Indicador | Resultat |
| --- | ---: |
| Missatges aportats | 20 |
| Coincidències amb les classificacions esperades de la prova | 20/20 |
| Missatges acceptats de l'activitat | 18 |
| Missatges d'una altra activitat descartats | 1 |
| Duplicats detectats | 1 |
| Dades noves incorporades a la fitxa | 5 |
| Dades repetides reconfirmades des de fonts | 6 |
| Casos pendents de revisió | 3 |
| Preguntes amb dades disponibles | 8/10 |
| Preguntes no resoltes, honestament marcades com a tals | 2/10 |
| Propostes d'actualització de Google Calendar | 1 |
| Escriptures externes efectuades | 0 |

**Important:** «20/20» vol dir coincidència amb els resultats esperats d'aquestes vint frases preparades per al test. **NO** és una precisió demostrada del motor d'IA ni del producte sobre comunicacions reals. «8/10» és cobertura de respostes del prototip, **NO** una estimació estadística d'exactitud en famílies reals.

## Exemples de sortida
- «Fins quan hem de pagar?» → **18 de novembre de 2026**, amb 3 fonts d'entrada.
- «A quina hora hem d'arribar?» → **16:15**, amb avís de possible rectificació pendent.
- «A quina hora comença?» → **17:00**, però existeix una comunicació contradictòria que diu 18:00; no sobreescriu la dada silenciosament.
- «Què hem de portar?» → **vestuari de ball posat**, amb font WhatsApp.
- «Ja està pagat?» → **no consta un comprovant fiable**; no dedueix un pagament d'un «ja he pagat» informal.
- «Què passa amb la sortida?» → **comunicació detectada però sense vincular** a un esdeveniment verificat; exigeix revisió.

## Tres incidents deliberats correctament retinguts
1. «Potser arribarem a les 16:00» no modifica les 16:15 confirmades.
2. Una comunicació que diu «el festival comença a les 18:00» entra en conflicte amb les 17:00 i queda en revisió.
3. Una sortida del grup del 28 de novembre no s'assigna automàticament al festival del 21 de novembre.

## Fitxers nous
- `lib/premium-natural-intake.js`: extractor de text experimental, preguntes i preparació de fitxa, sense accés extern.
- `tests/fixtures/premium-20-natural-messages.json`: 20 comunicacions fictícies amb resultats esperats.
- `tests/run-premium-natural-intake.js`: comprovació de dades, fonts, ambigüitats, deduplicació i propostes de Calendar.

Les suites anteriors `tests/run-activity-sync.js` i `tests/run-premium-agent-pilot.js` continuen superant les proves.

## Limitacions i riscos coneguts
- El parser reconeix **un conjunt reduït de patrons de català**: encara no entén circulars arbitràries com ho faria un model d'IA; els casos reals poden fallar.
- Assumeix **una sola activitat i un sol esdeveniment identificat**. No és apte per múltiples sortides, entrenaments i pagaments simultanis.
- Com que les dades del test són de novembre de 2026, la representació d'hores local utilitza una convenció CET de prova. Cal implementar càlcul real de zona horària i horari d'estiu abans d'operar Calendar.
- No està resolta l'extracció de dades a partir d'imatges, PDFs o àudios.
- No existeix captació real de correus, WhatsApp, gestió d'auth de famílies, base de dades persistent ni confirmacions.
- L'API WhatsApp Business habitual no permet llegir lliurement l'historial de grups privats existents. L'automatització ha de partir de fonts consentides i de viabilitat tècnica comprovada.
- Les dades escolars i de menors requereixen controls explícits d'accés, minimització, esborrat i no-publicació a GitHub.
- Un model d'IA pot equivocar-se; un camp de confiança retornat pel model, per si sol, no justifica modificar Calendar.

## Següent pas tècnic prioritzat
**Extracció amb un model d'IA real i un conjunt cec de noves comunicacions fictícies**, amb validació estricta de JSON, font i evidència. Comparar precisió, terminis, contradiccions i cost contra la línia base de regles. Després: identitat de família, fitxes persistents, Gmail OAuth de Premium, ingesta autoritzada de WhatsApp i Google Calendar OAuth en mode dry-run abans de cap escriptura.

La decisió comercial segueix: Free analitza; Premium inclou lectures il·limitades sota ús raonable, Gmail, Google Calendar i prova de l'agent; el nivell superior amplia autonomia i ús de l'agent. **No es modifica la web ni cap preu sense una nova instrucció.**
