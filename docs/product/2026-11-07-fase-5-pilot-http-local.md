# NEXLUPA Agent — Fase 5: prova HTTP local, signatura real i regressió CI
**Data:** 7 de novembre de 2026
**Estat:** prototip HTTP exclusivament local, **sense desplegament ni recepció real de correus**.
**Branca:** `product/whatsapp-premium-20261107` · PR #4 draft.
**Regla:** no tocar `main`, web, landing, preus ni producció.

## Objectiu
Validar que un correu fictici reenviat al sistema de NEXLUPA pot entrar per HTTP, passar una signatura de Mailgun, associar-se a una família i activitat registrades, conservar-se localment, resistir duplicats i quedar disponible per alimentar el motor de la fitxa, sense barrejar famílies.

## Implementació
- `scripts/premium-mailgun-local-pilot.js` — servidor HTTP **només per a loopback** (127.0.0.1) creat en memòria quan un test o script crida `createLocalPilot`. **No s'executa ni desplega per si sol**.
- Ruta `POST /inbound/mailgun`; accepta exclusivament `application/x-www-form-urlencoded` (correus sense adjunts), amb màxim **32 KiB** de cos i rebuig de camps repetits o perillosos. No es processen `multipart/form-data` ni PDF/imatges.
- Comprova `timestamp`, `token` i HMAC-SHA256 de la petició signada amb l'adaptador ja creat. Evita repetir un token després de reiniciar el servidor local, i identifica missatges repetits amb una empremta de contingut **per família**.
- La signatura prova que la petició està signada pel **proveïdor**, **NO** la identitat del pare/mare. La funció `senderProof` ha de proporcionar una verificació independent des d'una capa de confiança; **per defecte és falsa**. Les proves la simulen deliberadament per verificar el recorregut, però això NO és autenticació de producció.
- Els missatges acceptats es desen en una cua local de fitxers de prova amb permisos 0600, noms basats en SHA-256 i creació enllaçada sense sobreescriure una entrada preexistent. Missatges dubtosos desen **només metadades** i no el text.
- Les respostes HTTP són 200 en acceptacions i duplicats; errors de format i signatura es rebutgen. Si falla la persistència, 503 per permetre reintents. Mailgun documenta 200 com a acceptat, 406 com a rebuig sense reintents, i reintents per altres codis.

## Resultat de verificació
**GitHub Actions ha completat correctament les 10 suites de regressió del prototip amb Node.js 22.**

Execució CI: https://github.com/DavidParet/Primer-projecte/actions/runs/42370762933

La prova HTTP de la fase 5 cobreix:
1. Petició HTTP amb camps correctes i HMAC signada.
2. Desament de la comunicació fictícia i identificació de la família A.
3. Família B amb el mateix tipus d'activitat però informació separada.
4. Repetició del mateix token, fins i tot **després d'un reinici**.
5. Reenviament idèntic amb token nou, però contingut repetit.
6. Rebuig de signatura falsa, camps repetits, mètode no permès, ruta equivocada, format incompatible i càrrega excessiva.
7. Correu amb remitent no verificat: revisió, **sense dades personals en la càrrega processable**.
8. Fitxers locals temporals eliminats al final del test.

Aquest conjunt és **sintètic**: no certifica operativitat en Mailgun real ni precisió d'un LLM en comunicacions reals.

## Límits de seguretat i desplegament
**PROHIBIT posar aquest servidor públicament sense refactorització.**
- La cua actual és un directori de fitxers de prova **sense xifrat en repòs**, sense retenció ni drets de supressió. Només apte per dades inventades.
- No hi ha autenticació real del remitent ni anàlisi d'alineament de SPF/DKIM/DMARC. L'HMAC no resol això. Mai derivar `senderProof` de la capçalera From, d'un camp controlat per l'usuari o únicament d'una allowlist.
- No hi ha cua/BD transaccional compartida entre instàncies, orquestració de workers ni traçabilitat operativa segura. El directori local no serveix per a Vercel/serverless.
- Els correus amb adjunts, HTML complex, PDF, fotos o molta longitud s'han de processar amb una canalització especial abans del pilot. No s'han d'ignorar silenciosament.
- Encara no hi ha proveïdor, domini, MX ni ruta de Mailgun configurats. Cap secret o adreça real s'ha publicat a GitHub.
- Google Calendar continua sent únicament **propostes**, sense accessos OAuth ni escriptures.
- No s'han utilitzat dades familiars reals ni s'ha fet cap petició de pagament a un model IA.

## Decisió de producte que queda implementada conceptualment
**Correu privat Gmail/Outlook/etc. → reenviament voluntari a un alias exclusiu NEXLUPA → identificar família → classificar activitat → fitxa viva.** Gmail OAuth complet és opcional i no és prerequisit. El mateix esdeveniment podrà rebre dades de WhatsApp autoritzat sense crear duplicats.

## Proper pas prioritari (Fase 6)
**Preparar la recepció real en un entorn de proves segregat**, però no activar-la fins a disposar de:
1. Compte Mailgun de prova o proveïdor equivalent, domini/subdomini dedicat, registres MX i endpoint HTTPS protegit.
2. Clau webhook de proves protegida; validació de proveïdor, tokens anti-replay en emmagatzematge transaccional i controls antiabús.
3. **Autenticació independent de remitent** a partir de resultats fiables del servei (SPF, DKIM, DMARC i alineament) i registre del titular, amb decisió conservadora en dubtes.
4. Base de dades/queue segura i xifrada, esborrat i minimització especialment per comunicacions de menors, auditoria i retenció configurada.
5. Només llavors, proves amb dos comptes de correu de demostració i missatges **ficticis**, i posteriorment integració d'IA amb pressupost acotat.

## Fonts documentals del proveïdor
- Signatura d'Inbound Routes: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
- Forward via HTTP i codis de resposta: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- Comunicació 08/05/2026 sobre resultats d'autenticació inclosos als inbound posts: https://www.mailgun.com/releases/authentication-results-in-inbound-route-url-posts/

**Producció intacta.** La fase 5 no modifica cap compte, domini, web ni servidor extern.
