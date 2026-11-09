# NEXLUPA Agent — Tancament intern del circuit de correu reenviat
**Data:** 7 novembre 2026
**Estat:** prototip funcional amb dades sintètiques, **NO servei d'email real**.
**Branca:** `product/whatsapp-premium-20261107`. `main` i web/producció intactes.

## Objectiu
Completar internament, amb dades fictícies, el recorregut:
**Gmail/Outlook personal → reenviar al destinatari familiar de NEXLUPA → validar missatge → identificar família → identificar activitat → cua → processador → fitxa viva → resposta amb fonts → proposta de Calendar**.

No cal una connexió OAuth al Gmail personal per fer el reenviament. L'alias destinatari identifica la família; la informació sobre l'activitat s'extreu del missatge i del context de la fitxa, amb revisió quan és ambigu.

## Implementat i provat
1. `lib/premium-forwarded-email.js`: normalització de correus reenviats, identificació de família amb alias exclusiu, comprovació de remitent registrat i deduplicació de contingut.
2. `lib/premium-family-inbox.js`: fitxes separades per família i activitat i cua de revisió.
3. `lib/premium-mailgun-inbound-adapter.js`: firma HMAC i protecció contra falsificacions/repeticions; **el HMAC prova el proveïdor, no la identitat real del remitent**.
4. `scripts/premium-mailgun-local-pilot.js`: receptor HTTP de prova, només a `127.0.0.1`, amb límits d'entrada i persistència local de missatges **sintètics**. No disposa d'endpoint a Internet.
5. `lib/premium-mailgun-queue-worker.js`: **nou** processador de la cua, per alimentar les fitxes a partir de missatges ja acceptats. Distingeix duplicats, errors reintentables, registres que no corresponen a la família i missatges no revisats. No modifica Calendar ni envia missatges.
6. `lib/premium-ai-extractor.js` i `lib/premium-agent-pipeline.js`: preparació d'extracció per model d'IA i reconciliació de dades; en els tests l'IA és simulada.
7. `lib/premium-ai-answerer.js`: respostes sobre dades traçables de la fitxa (termini, hora, material, etc.); es declara desconegut quan no hi ha evidència.

## Resultats de proves
**GitHub Actions ha executat correctament 11 bateries de tests interns amb Node.js 22**, incloent `tests/run-premium-mailgun-queue-worker.js`:
https://github.com/DavidParet/Primer-projecte/actions/runs/42372437792

La bateria nova valida:
- Dues famílies, totes dues amb «Ball», amb **terminis diferents** de pagament i fonts separades.
- Missatges acceptats → dades estructurades de la fitxa; respostes amb font `email-forwarded`.
- Duplicitats i registres pendents de revisió → no es fan trucades addicionals a la IA.
- Error simulat del model → missatge reintentable sense perdre'l del procés de prova.
- Incoherència família/fitxa → rebuig i cap filtració entre famílies.
- Una única proposta de canvi de Calendar, **mai escriptura real**.

**Aclariment:** les 11 bateries comparen comportaments esperats de dades sintètiques, no mesuren la precisió d'una IA en correus reals ni garanteixen que el servei real funcioni.

## Què impedeix considerar-lo «operatiu»
- No hem configurat ni activat **Mailgun** (ni un proveïdor alternatiu): no hi ha domini/subdomini de recepció, registres MX, ruta d'entrada ni endpoint HTTPS accessible.
- Encara falta un **adaptador de confiança per autenticar remetents** amb informació real del proveïdor i dades de registre. Mailgun informa SPF/DKIM/DMARC als posts entrants, però el format i la validació efectiva han de provar-se en un compte de test. No es pot deduir la identitat només per una adreça de remitent o per la signatura del webhook.
- La cua local és per a **dades inventades**: no té xifratge en repòs, política de retenció/esborrat ni base de dades transaccional compartida. No desplegar-la ni posar-hi comunicacions escolars reals.
- Falta gestionar adjunts (PDF, imatges, circulars HTML complexes), autenticació de famílies, persistència de les fitxes i còpies de seguretat.
- No s'ha provat un model d'IA real: crides de prova actuals són simulades.
- No hi ha Google Calendar OAuth ni escriptures; només propostes de canvis.
- Les funcions que consumeixen fitxes en memòria no són un worker de producció, perquè no poden garantir la persistència transaccional conjunta de dades/ack/reintents.

## Condicions per activar pilot extern separat
1. Entorn de proves independent del domini i de la web de producció.
2. Compte i subdomini de recepció, webhook HTTPS amb secrets segurs.
3. Autenticació real del servei emissor i del remitent, rate limiting, prevenció de replay atòmica.
4. Emmagatzematge xifrat amb segregació per família i retenció mínima, gestió d'adjunts i esborrat.
5. Dos comptes de correu **de proves**, amb missatges ficticis; prova end-to-end, després prova amb IA real de cost limitat.
6. Revisió abans de qualsevol activació pública, especialment perquè els correus poden contenir informació de menors.

## Decisió de treball
**Part de correu: tancada com a prototip intern provat.** La següent etapa, recepció real, té dependències de compte/secret/domni i infraestructura que encara no han estat autoritzades/configurades. No es considera «Mailgun connectat» ni «NEXLUPA ja rep correus reals».
**WhatsApp aparcat per ara**, segons la instrucció de concentrar-nos en completar el correu.
