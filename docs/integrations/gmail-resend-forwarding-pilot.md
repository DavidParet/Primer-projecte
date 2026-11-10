# NexLupa · Primer pilot Gmail → Resend (sense OAuth restringit)

**Estat de treball 11/11/2026:** desenvolupament aïllat, PR #16 en draft. NO enviar ni reenviar correus reals fins que la família pilot, el consentiment i el pipeline d'entrada s'hagin verificat. La producció de NexLupa no incorpora aquest mòdul.

## Circuit objectiu

1. Una família autoritza explícitament `resend_forward/read_school_mail` i obté una adreça d'entrada aleatòria i no predictible com `in-<32 hex>@entrada.nexlupa.app`. L'alias no revela dades personals.
2. Gmail verifica l'adreça de reenviament. Es crea UN filtre exclusivament per als remitents/comunicacions escolars aprovats. **No activar el reenviament global**. Els missatges continuen a Gmail.
3. Resend (domini receptor verificat) notifica `email.received` al webhook per POST.
4. Abans de llegir JSON o informació de missatges, el servidor valida la signatura Svix del **cos cru**, la marca de temps i la mida. Rebutja modificacions i replays; no exposa secrets.
5. L'aplicació exigeix un sol destinatari per al pilot i cap adjunt; resol el destinatari mitjançant una consulta SQL segura, no amb `From`, `Subject` ni el contingut del correu.
6. Consulta l'associació familiar i el consentiment vigent abans de registrar una única recepció de metadades. La cua ha de tenir una restricció UNIQUE sobre la clau SHA-256 per deduplicar retries i webhooks.
7. **Segona fase, no implementada al PR #16:** un treballador amb autorització recupera un únic correu via l'API de Resend, comprova de nou família, consentiment, qualitat i integritat del missatge, i crea una proposta de fitxa per revisió humana. Sense accions automàtiques, enviaments ni Calendar.

## Evidència constatada

- Resend: `entrada.nexlupa.app` verificat, `Receiving: enabled`, `Sending: disabled`. Un únic webhook estable `email.received` habilitat; el webhook de preview duplicat s'ha desactivat.
- El codi del receptor estable `nexlupa-resend-pilot` actual només fa verificació criptogràfica. NO equival a ingestió de contingut en NexLupa.
- Neon, branca aïllada `resend-worker-consent-validation-20261108`: `intake_bridge_health()` retorna `receipts=2`, `pending=1`, `signed_family_matches=0`, `eligible_for_processing=0`, `blocked_unrouted=1`. No s'han llegit dades de missatges.
- Nou mòdul `lib/forwarding/resend-intake.cjs`: signatura, destinatari únic, alias aleatori, consentiment revalidat i hash idempotent. `lib/forwarding/neon-receipt.cjs`: adaptador **en codi, no desplegat** que prepara un rebut de metadades xifrat AES-256-GCM i un INSERT amb autorització atòmica via RPC + ON CONFLICT, sense llegir el cos del correu. Ja existeix el codi HTTP aïllat del pilot, però sense desplegament verificat del commit més recent i sense secrets, associacions o correus reals.
- Tests offline i PostgreSQL disposable sota GitHub Actions: **41/41 correctes**, última execució #42926206952. Inclou 36 proves offline i 5 proves en un servei PostgreSQL 16 temporal, sense Gmail, Resend ni Neon en CI; les consultes a Neon real es documenten més avall.
- Preview de Vercel del commit `f1edf3002886849c051df99f1c834ad59a161779`: **READY**. Per eliminar l'error de patrons de rutes del `main` s'han adaptat `vercel.json` i `scripts/build-static.js` de la branca Gmail verificada. Aquest solapament s'ha de resoldre abans de fusionar cap PR.

## Portes pendents abans del pilot amb correus ficticis

- [ ] Identitat de família pilot verificada a Neon i consentiment explícit registrat.
- [ ] Alias aleatori associat a família amb `resolve_authorized_recipient` i revocació funcional. Sense alias no es pot atribuir cap correu a una família.
- [x] Comprovar en PostgreSQL real la deduplicació seqüencial amb una família i consentiment ficticis, sense deixar registres.
- [x] Verificar concurrència de 12 reentregues simultànies amb PostgreSQL 16 temporal i un rol de base de dades restringit: 1 alta, 11 duplicats, 1 únic rebut.
- [x] Verificar en CI el desxifrat AES-256-GCM amb AAD lligat a `queue_id` i el rebuig de ciphertext manipulat, fila intercanviada i clau incorrecta. El worker definitiu encara no està connectat.
- [ ] Verificar revocació **simultània** amb una inserció en trànsit i limitar la taxa; el test només confirma revocacions ja confirmades abans d'un nou intent.
- [x] Ruta HTTP de preview **implementada en codi**, separada del webhook estable; signatura comprovada abans d'inicialitzar PostgreSQL; cap resposta amb dades privades. **Encara pendent: desplegament i prova HTTP en Vercel**.
- [ ] Confirmació de l'adreça a Gmail i filtre selectiu definit amb revisió humana; sense reenviament global.
- [ ] Prova de 1–3 correus **inventats**, sense dades personals ni de menors: un accepted/queued, un duplicate, un no autoritzat i revocació.
- [ ] Comparar recepció amb fitxes en revisió i comprovar zero enviaments/Calendar. No publicar a `main` sense aprovació.

## Font de procediment

- Google: https://support.google.com/mail/answer/10957 — la verificació és obligatòria; els filtres de reenviament només afecten missatges futurs i són alternatius al reenviament global.
- Resend: https://resend.com/features/webhooks — format `email.received` i metadades del webhook.

**Conclusió:** hem validat el codi de la barrera d'entrada, no el circuit complet. Falta específicament vincular l'alias al consentiment i a la cua abans de tractar missatges.


### Barrera tècnica observada — permisos del rol de recepció

**Històric:** el rol `nexlupa_resend_ingest` inicialment no tenia USAGE de l'esquema RPC ni EXECUTE de `resolve_authorized_recipient(text)`. **Actualització 11/11/2026:** s'han concedit només aquests dos permisos, exclusivament a la branca **no principal** de Neon `resend-worker-consent-validation-20261108`. Comprovació posterior: és l'única de les 13 funcions RPC executable per aquest rol; continua sense USAGE directe a l'esquema de dades familiars. La funció aplica alias actiu, família pilot/activa i consentiment `resend_forward/read_school_mail` no revocat. Cap permís nou a la branca primària.

### Darrera comprovació CI

[GitHub Actions run 42924900121](https://github.com/DavidParet/Primer-projecte/actions/runs/42924900121): **39 tests, 39 pass, 0 fail** (35 offline i 4 PostgreSQL real efímer), més instal·lació correcta del driver `pg` i importació de l'endpoint. Test de 12 reentregues simultànies, autorització amb rol restringit, revocació, xifrat AES-256-GCM amb integritat associada a la fila, signatures i barreres HTTP. Sense comptes reals ni missatges de Gmail o Resend a CI.


### Validació tècnica del 11/11/2026

**Neon real, branca aïllada i rol `nexlupa_resend_ingest`:** 
- `GRANT USAGE ON SCHEMA nexlupa_worker_rpc` i `GRANT EXECUTE ON FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(text)`, sense altres EXECUTE ni accés directe a taules familiars.
- Execució amb credencials del **rol destinatari real**: destinatari fictici no autoritzat retorna `NULL`. L'INSERT SQL complet amb el mateix destinatari retorna `outcome='revoked'`. No genera fila: `unexpected_receipts=0`.
- L'indicador de la cua no ha variat: `receipts=2`, `pending=1`, `signed_family_matches=0`, `eligible_for_processing=0`, `blocked_unrouted=1`.
- **Prova positiva seqüencial executada a PostgreSQL real:** família, alias i consentiment ficticis creats sota SAVEPOINT; primera recepció `inserted`, segona idèntica `duplicate`, i `ROLLBACK TO SAVEPOINT` verificat: 0 famílies, aliases i rebuts ficticis restants. L'execució de la prova positiva s'ha fet amb el rol propietari necessari per crear les fixtures, **no** amb el rol receptor de webhook. Aquest darrer ha passat la prova real negativa de permisos i alias desconegut.
- **Prova de consentiment revocat executada:** amb una fixture 100% fictícia de consentiment amb `revoked_at` informat, `resolve_authorized_recipient` ha retornat `NULL`; després de rollback queden 0 consentiments ficticis.
- La **concurrència d'INSERT**, la revocació simultània amb una recepció i la compatibilitat amb el desxifrat del worker **encara no s'han executat** sobre PostgreSQL, i continuen pendents abans del pilot real.

**Codi HTTP preview afegit, però encara NO desplegat en la darrera revisió:**
- `api/forwarding/pilot-webhook.js` i `lib/forwarding/{http-handler,runtime}.cjs` posen el processament darrere de triple condició: Vercel `preview`, branca exacta de pilot i `FORWARDING_PILOT_ENABLED=true`. Producció sempre inhabilitada.
- `FORWARDING_PILOT_ENABLED=false` s'ha desat explícitament a les variables de Vercel **només per a aquesta branca**. No s'ha creat cap secret de Resend ni cap encaminament de webhook a la nova ruta.
- El GET de supervisió només indica configuració, **no afirma una connexió real a Neon**. El POST compara la signatura abans de preparar la connexió PostgreSQL. Els errors transitoris responen 503 per permetre reintents; els rebuts rebutjats s'acusen sense filtració de contingut.
- `package.json` ara inclou el connector PostgreSQL `pg` i GitHub Actions verifica la càrrega del mòdul Vercel.

**Bloqueig de desplegament:** un intent explícit de previsualització de l'últim commit ha retornat **HTTP 402**, recurs `api-deployments-free-per-day` (límit diari de més de 100 despl.). El darrer desplegament `READY` visible era d'un commit anterior a l'endpoint nou. No s'ha fet cap actualització de pla, càrrec, promoció ni fusió de PR; no afirmar verificació HTTP del nou endpoint fins que Vercel ho permeti.

**Fites encara no completades:** provar INSERT positiu i idempotència/revocació amb fixtures aïllats i consentits, validar endpoint de preview HTTP, crear vincle alias-família de prova, configurar exclusivament el reenviament selectiu amb verificació de Gmail i completar el flux fins a fitxa de revisió. La recepció real a Resend continua separada de l'API nova.


### Actualització 11/11/2026 — proves concurrents i preparació de Vercel

- S'ha afegit `tests/forwarding-postgres.integration.cjs` amb un **PostgreSQL 16 efímer** desplegat dins GitHub Actions (no és Neon ni una base de dades familiar real). 12 crides signades simultànies al mateix correu fictici han retornat **1 `queued` i 11 `duplicate`**, amb exactament una fila al servidor. També s'ha provat la revocació prèvia al nou intent i la impossibilitat de consultar directament la taula d'autorització amb el rol restringit.
- `lib/forwarding/neon-receipt.cjs` utilitza ara **AAD = queue_id** a AES-256-GCM i exposa un descodificador server-side que rebutja ciphertext manipulat, claus errònies o intents de moure el contingut xifrat a un altre identificador. El format ha superat proves de xifrat/desxifrat tant offline com al PostgreSQL efímer.
- Variables Vercel exclusives de la branca de preview: `FORWARDING_PILOT_DATABASE_URL` (**sensitive**, rol `nexlupa_resend_ingest` limitat a la branca Neon de validació i `sslmode=verify-full`), i `FORWARDING_PILOT_ENABLED=false`. No s'han creat els secrets de verificació del nou webhook ni d'encriptació per a l'execució real, i no s'ha apuntat cap webhook actiu a aquesta ruta.
- **Verificació HTTP d'una previsualització automàtica anterior:** `GET /api/forwarding/pilot-webhook` ha retornat **HTTP 200**, amb `configurationPresent:false`, `databaseConnectivityVerified:false`, `metadataReceiptsEnabled:false` i `productionEnabled:false`. Això confirma que la ruta es publica i funciona **desactivada**, però no que la versió de xifrat més recent ja s'hagi desplegat ni que la connexió PostgreSQL sigui funcional en Vercel.
- Els últims commits de prova no tenen desplegament Vercel verificat per la quota de desplegaments. El CI funciona de manera independent. Encara cal un test HTTP POST amb signatura real del pilot, connexió de la cua a Neon amb alias i consentiment explícit i prova de revocació concurrent.

**Important:** proves de concurrència en PostgreSQL local de CI i deduplicació seqüencial a Neon **no equivalen** a una prova completa sota múltiples instàncies Vercel amb correus reals. No promoure el PR ni activar el pilot abans d'aquesta validació.


### Validació 11/11/2026 — contracte Resend i HTTP real en CI

- **41/41 proves superades, 0 errors** a [GitHub Actions #42926206952](https://github.com/DavidParet/Primer-projecte/actions/runs/42926206952): 36 proves offline i 5 amb PostgreSQL 16 temporal.
- Contrastat el contracte `email.received` amb l'[exemple oficial de Resend](https://resend.com/features/webhooks): el payload inclou `data.email_id`, `to[]`, `from`, `subject`, `message_id` i `attachments[]`. S'ha afegit una prova amb aquesta estructura completa. El mòdul pilot **només accepta** un destinatari i zero adjunts, i enregistra exclusivament metadades imprescindibles, mai `from`, `subject` o cos.
- **HTTP POST end-to-end en CI**, no un mock de funció: un servidor HTTP efímer ha rebut un esdeveniment fictici amb signatura Svix vàlida i l'ha inserit a PostgreSQL amb rol limitat (HTTP 204); reintent ha retornat 204 sense crear duplicat; signatura falsa ha retornat HTTP 400. Tot sense accedir a Resend, Gmail ni Neon reals.
- En secrets de Vercel exclusius del preview d'aquesta branca, `FORWARDING_PILOT_DATABASE_URL` i `FORWARDING_PILOT_ENCRYPTION_KEY` consten com a `sensitive`. La clau de xifrat del pilot s'ha creat amb entropia criptogràfica i no s'ha imprès. `FORWARDING_PILOT_ENABLED=false` es manté verificat.
- El secret **propi d'un webhook de Resend per a aquest endpoint** encara no està creat ni configurat. El webhook actiu estable NO s'ha redirigit.
- **No donar aquesta fase per completada:** falta provar el nou desplegament HTTP a Vercel amb el secret de webhook adequat, el consentiment d'una família pilot i el reenviament selectiu verificat de Gmail; mantenir tallada la recepció real fins que aquestes comprovacions passin. També cal testar revocació que coincideixi temporalment amb una inserció.

Aquest treball és de codi i proves aïllades. Cap missatge real ha entrat per la nova ruta i no s'ha fet cap fusió a `main`.
