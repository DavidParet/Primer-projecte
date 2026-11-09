# NEXLUPA Agent — Fase 4: adaptador de correu entrant autenticat
**Data:** 7 de novembre de 2026 · **Estat:** prova interna sintètica, NO desplegada.
**No tocar:** web, `main`, producció, DNS, Gmail/Outlook de famílies, Google Calendar ni preus.

## Decisió provisional: Mailgun com a primer proveïdor a avaluar
El flux desitjat és **correu personal (qualsevol proveïdor) → reenviar a un alias únic de NEXLUPA → validar família → fitxa de l'activitat → preguntes de l'agent i propostes de Calendar**.

- **Mailgun Routes** ofereix `forward(URL)` i envia un POST `application/x-www-form-urlencoded` o `multipart/form-data` amb `recipient`, `sender`, `from`, `subject` i `body-plain`. Cada petició de Routes porta `timestamp`, `token` i `signature`.
- **Resend Inbound** és una alternativa vàlida; el webhook `email.received` porta metadades i la lectura del cos requereix una petició addicional a l'API. Revisar costos, condicions, tractament de dades i viabilitat abans de decidir.
- No crear un compte Gmail per família. Una única infraestructura receptora amb **aliases exclusius** per família és suficient conceptualment.

Fonts oficials consultades:
- Mailgun HTTP Route Forward: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- Mailgun Webhook Signature: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
- Mailgun retry/response codes: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- Resend receiving: https://github.com/resend/resend-skills/blob/main/skills/resend/references/receiving.md

## Codi aïllat creat
- `lib/premium-mailgun-inbound-adapter.js`: valida una **signatura Mailgun** amb HMAC-SHA256 calculat sobre la concatenació `timestamp + token`, comparació constant-time, verificació de caducitat, consulta d'un conjunt de tokens utilitzats; projecta els camps d'un POST de Mailgun en una entrada interna per al motor de NEXLUPA.
- `lib/premium-mailgun-inbox.js`: uneix aquest adaptador amb `lib/premium-family-inbox.js`; lliura la comunicació a la fitxa familiar correcta quan hi ha permisos, prepara una proposta de Calendar i retorna el token per a persistència atòmica futura.
- `tests/run-premium-mailgun-route.js`: proves de signatura, caducitat, replay, remitent no validat, suplantació de From, correu massa llarg, adjunts i fitxa.
- `tests/run-premium-mailgun-inbox.js`: prova integrada, amb dues famílies i una fitxa de Ball per família, de la ruta des del webhook signat fins a la fitxa, deduplicació, revisió i Calendar dry-run.
- `scripts/run-premium-prototype-tests.js` inclou ara **9 suites de regressió** de les diferents fases.

## Proteccions essencials i responsabilitats pendents
1. **Diferenciar origen de la petició d'identitat del remitent.** HMAC prova que el POST l'ha signat Mailgun; NO prova que el pare/mare realment hagi enviat el correu. L'adaptador exigeix `independentlyAuthenticatedSender=true` obtingut per una capa de verificació independent i de confiança. Aquesta capa **encara no existeix**. Els camps de verificació MAI s'han d'acceptar des del cos de la petició HTTP ni de les capçaleres del correu.
2. **Protegir contra replay.** El prototip accepta un conjunt de `usedTokens` i un període màxim de 9 hores, atès que Mailgun documenta reintents durant fins a 8 hores. En producció els tokens s'han de desar de manera **durable, atòmica i compartida entre instàncies**; un array de memòria NO és suficient.
3. **Evitar barreja entre famílies.** Alias destinatari únic i no endevinable, remitent registrat i prova d'identitat independent, fitxes i fingerprints per família. En cas de dubte no associar a cap altra família.
4. **Adjunt o contingut no suportat:** revisió i tractament posterior amb antivirus, límits de mida, parser MIME i extracció segura. Ara mateix el motor no processa adjunts; no es poden ignorar silenciosament circulars amb informació important.
5. **Missatges llargs:** màxim 8.000 caràcters al prototip; cal dividir-los o fer una extracció en fases abans de la beta.
6. **Privacitat:** cap text de correus reals a GitHub, minimització de contingut, xifratge, esborrat, registre d'auditoria, controls parentals i de permisos; cautela especial perquè les circulars poden contenir dades de menors.
7. **HTTP webhook absent.** No hi ha cap endpoint públic; caldrà triar un parser segur per URL-encoded i multipart, comprovar mida, rate limits, autenticació de Mailgun, durabilitat de la cua i resposta HTTP apropiada. La documentació de Mailgun indica 200=acceptat, 406=rebutjat sense reintents, altres codis=habitualment reintents.
8. **No executar la IA directament com a condició d'acceptació del correu:** la futura ruta HTTP ha de validar i guardar/encuar de manera durable, ACK, després processar l'agent asíncronament i registrar resultats i errors. El prototip encara ho executa en memòria.
9. **Subdomini separat:** quan s'aprovi, utilitzar un subdomini d'entrada dedicat per evitar alterar els registres MX del domini principal de l'usuari. No s'ha fet cap canvi DNS.

## Resultat de les proves
S'han executat lògicament les suites noves en un entorn JS experimental amb **respostes de model i interfície criptogràfica simulades**. Les suites de Node estan preparades per utilitzar `node:crypto` real i s'han d'executar novament en un entorn Node autoritzat abans del pilot extern.

Comprovat en aquest entorn:
- Rebuig de signatura falsificada, fora de termini o token repetit.
- Missatge d'un remitent no autenticat → pendent de revisió, no s'envia a la fitxa.
- Dos comptes de família: no hi ha fugues ni encreuaments.
- Reenviament duplicat: un sol processament útil, sense repetir la crida simulada a la IA.
- Resposta de l'agent basada en dada amb font; Calendar únicament fa una **proposta**, sense escriptura real.
- Error d'IA: no es marca el correu com a processat ni es consumeix el token al prototip.

## Següent fita
**Preparar un pilot E2E segregat** quan existeixin una clau de proves de Mailgun, el webhook autenticat, un mecanisme fiable de validació del remitent, registre durable/atomicitat i un compte autoritzat de prova. Primer Gmail i Outlook amb missatges exclusivament ficticis. Després avaluació d'IA real i connectar Calendar en dry-run amb credencials de test.

Fins aquell moment **cap adreça receptora real, cap correu enviat, cap webhook públic i cap canvi de producció**.
