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
- Nou mòdul `lib/forwarding/resend-intake.cjs`: signatura, destinatari únic, alias aleatori, consentiment revalidat i hash idempotent. `lib/forwarding/neon-receipt.cjs`: adaptador **en codi, no desplegat** que prepara un rebut de metadades xifrat AES-256-GCM i un INSERT amb autorització atòmica via RPC + ON CONFLICT, sense llegir el cos del correu. El codi HTTP aïllat del pilot ja té desplegament de preview verificat per GET, però no s'ha verificat una recepció POST signada real ni cap associació amb una família consentida.
- Tests offline i PostgreSQL disposable sota GitHub Actions: **52/52 correctes**, última execució #42927400232. Inclou 47 proves offline i 5 proves en un servei PostgreSQL 16 temporal, sense Gmail, Resend ni Neon en CI; les consultes a Neon real es documenten més avall.
- Preview de Vercel del commit `f1edf3002886849c051df99f1c834ad59a161779`: **READY**. Per eliminar l'error de patrons de rutes del `main` s'han adaptat `vercel.json` i `scripts/build-static.js` de la branca Gmail verificada. Aquest solapament s'ha de resoldre abans de fusionar cap PR.

## Portes pendents abans del pilot amb correus ficticis

- [ ] Identitat de família pilot verificada a Neon i consentiment explícit registrat.
- [ ] Alias aleatori associat a família amb `resolve_authorized_recipient` i revocació funcional. Sense alias no es pot atribuir cap correu a una família.
- [x] Comprovar en PostgreSQL real la deduplicació seqüencial amb una família i consentiment ficticis, sense deixar registres.
- [x] Verificar concurrència de 12 reentregues simultànies amb PostgreSQL 16 temporal i un rol de base de dades restringit: 1 alta, 11 duplicats, 1 únic rebut.
- [x] Verificar en CI el desxifrat AES-256-GCM amb AAD lligat a `queue_id` i el rebuig de ciphertext manipulat, fila intercanviada i clau incorrecta. El worker definitiu encara no està connectat.
- [ ] Verificar revocació **simultània** amb una inserció en trànsit i limitar la taxa; el test només confirma revocacions ja confirmades abans d'un nou intent.
- [x] Ruta HTTP de preview **implementada en codi**, separada del webhook estable; signatura comprovada abans d'inicialitzar PostgreSQL; cap resposta amb dades privades. **GET en previsualització verificat; POST signat encara pendent**.
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
- `FORWARDING_PILOT_ENABLED=false` s'ha desat explícitament a les variables de Vercel **només per a aquesta branca**. El webhook de proves antic s'ha reutilitzat i apuntat a la nova ruta, però continua desactivat. La clau pròpia de verificació queda protegida en Vercel.
- El GET de supervisió només indica configuració, **no afirma una connexió real a Neon**. El POST compara la signatura abans de preparar la connexió PostgreSQL. Els errors transitoris responen 503 per permetre reintents; els rebuts rebutjats s'acusen sense filtració de contingut.
- `package.json` ara inclou el connector PostgreSQL `pg` i GitHub Actions verifica la càrrega del mòdul Vercel.

**Bloqueig de desplegament:** un intent explícit de previsualització de l'últim commit ha retornat **HTTP 402**, recurs `api-deployments-free-per-day` (límit diari de més de 100 despl.). El darrer desplegament `READY` visible era d'un commit anterior a l'endpoint nou. No s'ha fet cap actualització de pla, càrrec, promoció ni fusió de PR; no afirmar verificació HTTP del nou endpoint fins que Vercel ho permeti.

**Fites encara no completades:** provar INSERT positiu i idempotència/revocació amb fixtures aïllats i consentits, validar endpoint de preview HTTP, crear vincle alias-família de prova, configurar exclusivament el reenviament selectiu amb verificació de Gmail i completar el flux fins a fitxa de revisió. La recepció real a Resend continua separada de l'API nova.


### Actualització 11/11/2026 — proves concurrents i preparació de Vercel

- S'ha afegit `tests/forwarding-postgres.integration.cjs` amb un **PostgreSQL 16 efímer** desplegat dins GitHub Actions (no és Neon ni una base de dades familiar real). 12 crides signades simultànies al mateix correu fictici han retornat **1 `queued` i 11 `duplicate`**, amb exactament una fila al servidor. També s'ha provat la revocació prèvia al nou intent i la impossibilitat de consultar directament la taula d'autorització amb el rol restringit.
- `lib/forwarding/neon-receipt.cjs` utilitza ara **AAD = queue_id** a AES-256-GCM i exposa un descodificador server-side que rebutja ciphertext manipulat, claus errònies o intents de moure el contingut xifrat a un altre identificador. El format ha superat proves de xifrat/desxifrat tant offline com al PostgreSQL efímer.
- Variables Vercel exclusives de la branca de preview: `FORWARDING_PILOT_DATABASE_URL` (**sensitive**, rol `nexlupa_resend_ingest` limitat a la branca Neon de validació i `sslmode=verify-full`), i `FORWARDING_PILOT_ENABLED=false`. Ara els secrets de verificació i xifrat estan protegits a Vercel; el webhook de proves apunta a la ruta però està desactivat. No hi ha cap webhook actiu nou apuntant a aquesta ruta.
- **Verificació HTTP d'una previsualització automàtica anterior:** `GET /api/forwarding/pilot-webhook` ha retornat **HTTP 200**, amb `configurationPresent:false`, `databaseConnectivityVerified:false`, `metadataReceiptsEnabled:false` i `productionEnabled:false`. Això confirma que la ruta es publica i funciona **desactivada**, però no que la versió de xifrat més recent ja s'hagi desplegat ni que la connexió PostgreSQL sigui funcional en Vercel.
- La ruta del preview està verificada per GET en un desplegament posterior, però encara no s'ha verificat POST. El CI funciona de manera independent. Encara cal un test HTTP POST amb signatura real del pilot, connexió de la cua a Neon amb alias i consentiment explícit i prova de revocació concurrent.

**Important:** proves de concurrència en PostgreSQL local de CI i deduplicació seqüencial a Neon **no equivalen** a una prova completa sota múltiples instàncies Vercel amb correus reals. No promoure el PR ni activar el pilot abans d'aquesta validació.


### Validació 11/11/2026 — contracte Resend i HTTP real en CI

- **41/41 proves superades, 0 errors** a [GitHub Actions #42926206952](https://github.com/DavidParet/Primer-projecte/actions/runs/42926206952): 36 proves offline i 5 amb PostgreSQL 16 temporal.
- Contrastat el contracte `email.received` amb l'[exemple oficial de Resend](https://resend.com/features/webhooks): el payload inclou `data.email_id`, `to[]`, `from`, `subject`, `message_id` i `attachments[]`. S'ha afegit una prova amb aquesta estructura completa. El mòdul pilot **només accepta** un destinatari i zero adjunts, i enregistra exclusivament metadades imprescindibles, mai `from`, `subject` o cos.
- **HTTP POST end-to-end en CI**, no un mock de funció: un servidor HTTP efímer ha rebut un esdeveniment fictici amb signatura Svix vàlida i l'ha inserit a PostgreSQL amb rol limitat (HTTP 204); reintent ha retornat 204 sense crear duplicat; signatura falsa ha retornat HTTP 400. Tot sense accedir a Resend, Gmail ni Neon reals.
- En secrets de Vercel exclusius del preview d'aquesta branca, `FORWARDING_PILOT_DATABASE_URL` i `FORWARDING_PILOT_ENCRYPTION_KEY` consten com a `sensitive`. La clau de xifrat del pilot s'ha creat amb entropia criptogràfica i no s'ha imprès. `FORWARDING_PILOT_ENABLED=false` es manté verificat.
- Secret propi del webhook pilot configurat a Vercel com a variable sensible i limitat a la branca. El webhook de proves continua DISABLED. El webhook estable de producció NO s'ha redirigit.
- **No donar aquesta fase per completada:** falta provar el nou desplegament HTTP a Vercel amb el secret de webhook adequat, el consentiment d'una família pilot i el reenviament selectiu verificat de Gmail; mantenir tallada la recepció real fins que aquestes comprovacions passin. També cal testar revocació que coincideixi temporalment amb una inserció.

Aquest treball és de codi i proves aïllades. Cap missatge real ha entrat per la nova ruta i no s'ha fet cap fusió a `main`.


### Actualització 11/11/2026 — barrera de lectura i revisió humana

- Creat `lib/forwarding/review-gate.cjs` (**encara no connectat a un worker productiu**) com a segon control independent de la recepció del webhook.
- El mòdul desxifra el rebut de metadades del servidor, comprova la correspondència exacta **àlies → família → consentiment vigent** i **només després** permet que l'adaptador cridi `Resend Receiving GET` per obtenir el contingut.
- Si el consentiment no hi és, **0 consultes a Resend**. Si és revocat mentre es recupera el correu, descarta el text abans de produir cap proposta de revisió.
- El pilot exigeix remitents aprovats per adreça exacta, un sol missatge de text pla, zero adjunts, una mida limitada i cap canvi automàtic. El cos de correu es marca `untrustedContent:true` i `requiresHumanApproval:true`; **no s'envia a cap model ni es genera cap acció en nom de la família**.
- **Limitació de seguretat:** validar el camp `From` contra una llista no prova per si sol l'autenticitat del remitent. Abans de connectar correus reals, caldrà revisar autenticació i procedència via capçaleres verificables i la política de reenviament, amb aprovació humana sempre.
- Les proves han detectat una ambigüitat del nom visible de remitent (`nom@domini <altra@domini>`); corregida amb un parser que rebutja aquestes formes i les capçaleres amb salts de línia.
- [GitHub Actions #42927400232](https://github.com/DavidParet/Primer-projecte/actions/runs/42927400232): **52/52 proves, 0 errors** (47 offline + 5 PostgreSQL efímer), incloses revocació abans/durant la recuperació de contingut i protecció contra instruccions dins de correus inventats.
- Vercel conserva `FORWARDING_PILOT_ENABLED=false`. El secret de signatura del webhook de proves està configurat, però aquest webhook segueix DISABLED. Encara no hi ha cap clau API de lectura Resend al worker, i aquest codi no pot llegir missatges reals per si sol.

**Proper obstacle real:** verificació del desplegament de la versió més recent, sender allowlist autoritzada per una família pilot, autenticació de font i consentiment explícit, seguit de la prova amb correus inventats i revisió humana.


### Actualització 11/11/2026 — recorregut complet en proves integrades

- S'ha afegit `lib/forwarding/resend-receiving-client.cjs`: adaptador de lectura **exclusivament GET** a l'API oficial de Resend Receiving, amb ID validat, resposta de mida limitada, timeout, sense redireccions ni dades d'HTML/capçaleres innecessàries. Sense clau real ni consulta a serveis externs en les proves.
- `lib/forwarding/review-gate.cjs` comprova també la **coincidència exacta del destinatari** entre el missatge recuperat i l'àlies de la família autoritzada. Es rebutja un correu d'un altre àlies fins i tot quan coincideixen remitent i ID.
- S'ha afegit una prova **de recorregut complet** amb PostgreSQL 16 efímer i servidor HTTP real local de CI: signatura Svix → recepció POST → cua xifrada i deduplicada → client Resend **simulat** → proposta `pending_human_review`, amb `approvedForAutoActions:false`. El cos no apareix a l'embolcall xifrat de metadades.
- Es comprova la revocació posterior: la mateixa proposta torna `consent_missing` i no fa cap segona crida al client de Resend. Això prova l'aturada abans de recuperar el contingut quan falta permís.
- [GitHub Actions #42929722396](https://github.com/DavidParet/Primer-projecte/actions/runs/42929722396): **62 proves correctes, 0 errors**, 56 offline + 6 PostgreSQL efímer. Comprovació d'importació i del driver `pg` mantinguda.

**Distinció important:** el circuit que s'ha provat va d'HTTP local en CI a un Resend GET simulat. No verifica un enviament real de webhook Resend a Vercel, ni la verificació de l'adreça de reenviament a Gmail. La branca encara no està fusionada, `FORWARDING_PILOT_ENABLED=false` i no s'han llegit correus reals.

**Portes següents:** entrada pública segura per superar SSO de Vercel, consentiment verificat d'una família pilot, comprovació de POST signat i aprovació del filtre selectiu Gmail. La font del correu requerirà més controls d'autenticitat que una llista de remitents `From`.


### Actualització 11/11/2026 — leases per al futur worker, encara desconnectats

- Nou `lib/forwarding/worker-lease.cjs`: protocol de **reserva temporal atòmica** `FOR UPDATE SKIP LOCKED` i `UPDATE ... RETURNING`, amb `lease_token` UUID aleatori, caducitat curta, reintents limitats i finalització només si el token i el termini continuen vigents.
- La reserva exigeix **un rol de worker diferent** del rol receptor `nexlupa_resend_ingest`. Només s'ha simulat aquest rol amb `nexlupa_reviewer_ci` dins del PostgreSQL efímer de GitHub Actions; **no s'han concedit privilegis nous a Neon ni s'ha engegat cap worker en Vercel**.
- `needs_review` requereix que el codi cridador indiqui que la fitxa de revisió ja està desada; el mòdul de leases no desa cap cos de correu ni crea automàticament una fitxa.
- Prova amb **12 peticions concurrents i dos rebuts de prova:** cada rebut queda reservat per un únic treballador; un token caducat no pot completar-lo, el nou propietari el pot recuperar, una tasca completada no es pot marcar dos cops i un reintent es programa en el futur.
- [GitHub Actions #42930973279](https://github.com/DavidParet/Primer-projecte/actions/runs/42930973279): **63/63 proves superades**, 56 offline + 7 PostgreSQL 16 efímer. Sense Resend ni Gmail reals.

**Bloquejos que continuen oberts:** quota de desplegaments Vercel per a la darrera revisió (HTTP 402 al darrer intent), secret del webhook pilot (ja configurat), credencial de lectura Resend limitada, consentiment explícit i alias de família pilot, comprovació de font de correu i filtre selectiu Gmail. `FORWARDING_PILOT_ENABLED=false`, PR #16 en esborrany, producció no modificada.

**Limitació pendent abans de connectar el worker:** persistir una proposta de revisió xifrada amb permisos mínims i revisió humana real, en lloc de limitar-se a marcar la cua.


### Verificació de Vercel (última revisió desplegada)

- El commit `777d24eee4c838f7a029c0e84b12541620b0588e`, posterior a les **63 proves verdes**, ha estat desplegat automàticament a Vercel en estat **READY**; el desplegament no ha requerit canvis de pla.
- **Prova HTTP real**: `GET https://primer-projecte-47h83u7vc-davidparets-projects.vercel.app/api/forwarding/pilot-webhook` → **200 OK** amb `configurationPresent:false`, `databaseConnectivityVerified:false`, `emailBodiesFetched:false`, `metadataReceiptsEnabled:false`, `productionEnabled:false`. `Cache-Control: no-store, private`.
- El desplegament **ja no està bloquejat** per al commit anterior. L'error 402 registrat en intents de desplegament **manuals** és històric; no vol dir que la versió automàtica actual no estigui disponible.
- **No s'ha provat POST contra aquest Vercel**: la interfície de comprovació disponible només fa GET. El webhook pilot ja té secret de signatura independent però continua desactivat, i no hi ha consentiment de família pilot; a més, el domini de preview està darrere de Vercel Authentication.
- La pàgina de diagnòstic no afirma connectivitat amb Neon, i la bandera de pilot continua `false`. Aquest estat és el comportament correcte fins que hi hagi consentiment i una validació d'entrada signada.


### 11/11/2026 · Webhook de proves recuperat, secret protegit i bloqueig SSO verificat

**Canvi real en Resend i Vercel, sense flux entrant actiu:**

- Reutilitzat el webhook de proves preexistent `26b5d6b0-d954-4877-afb4-c038efd34297` (`email.received`), abans amb una URL efímera. L'endpoint ara és la **branca estable** `https://primer-projecte-git-feature-gmail-r-560c64-davidparets-projects.vercel.app/api/forwarding/pilot-webhook`.
- El webhook de proves s'ha mantingut **`disabled`** en l'actualització i s'ha tornat a verificar després. El webhook estable `99ee8d6e-94e1-41ae-a9ef-e0a7408afa81` continua **`enabled`** i sense canvis: hi ha exactament un webhook actiu, no dos.
- El secret de signatura específic del webhook desactivat està desat com a **`FORWARDING_PILOT_WEBHOOK_SECRET` de tipus `sensitive` a Vercel, `preview` i `gitBranch` exclusivament al pilot**. Comprovada la independència del secret del webhook de producció i la compatibilitat sintàctica amb l'HMAC Svix. No s'ha exposat cap secret en el codi ni en el registre.
- **`FORWARDING_PILOT_ENABLED=false`** manté tota la recepció real desactivada; el secret d'encriptació i la connexió restringida a Neon continuen protegits.
- El GET de la URL estable via l'accés autenticat de Vercel retorna **HTTP 200** amb `metadataReceiptsEnabled:false`.

**Nou bloqueig material descobert abans de l'activació:**

- La configuració real del projecte Vercel mostra `ssoProtection.enabled=true`, `deploymentType=all_except_custom_domains`. Per tant, la branca `.vercel.app` requereix autenticació Vercel per a trucades de tercers. L'accés autenticat de ChatGPT **no demostra que Resend pugui fer un POST públic**, i el webhook desactivat no ha provat cap lliurament.
- Les [instruccions oficials de Vercel](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection) confirmen que es pot usar un secret de bypass per automatització amb paràmetre URL, però un bypass compartit pot donar accés ampli als desplegaments protegits. **No se n'ha creat cap ni s'ha desactivat l'SSO.**
- **Opció recomanada abans de cap correu personal:** un microservei públic **aïllat** amb una sola ruta de webhook, signatura obligatòria, cua limitada al pilot i sense exposar l'app principal. És una decisió arquitectònica pendent, no una integració ja completada. També és possible un domini personalitzat de branca, però exposaria més superfície de la necessària.
- **Portes abans d'activar**: resoldre l'entrada pública segura, preparar alias i consentiment explícit, verificar un POST `email.received` completament sintètic, proves de revocació simultània, clau API de Resend de lectura segregada i només després filtres selectius Gmail.

**Conclusió actual:** webhooks i claus preparats i segurs, però `Gmail → Resend → NexLupa` **encara no rep correus reals**. No publicar ni fusionar automàticament.


### 11/11/2026 · Passarel·la pública separada (implementació en curs)

**Nou projecte Vercel creat:** `nexlupa-forwarding-gateway` (`prj_xjsIRCabOGPFZmMBLyxrnuoSPnSe`) en el mateix equip, però **independent del projecte de l'aplicació principal**. Té una connexió GitHub al repositori `DavidParet/Primer-projecte`; el servei està a la subcarpeta `gateway/`.

**Codi i comprovacions:**
- `gateway/api/webhook.js` és l'única funció HTTP del projecte: `POST /api/webhook` amb cos cru, validació HMAC Svix abans de PostgreSQL i cua de metadades xifrada i deduplicada. `GET /api/webhook` retorna únicament l'estat de configuració, sense secrets ni contingut.
- Còpia separada i auditable dels mòduls de recepció, autorització i xifrat sota `gateway/lib/`. `gateway/package.json` és autònom i la funció no depèn de la interfície principal.
- La suite independent `.github/workflows/forwarding-gateway-tests.yml` ha superat **41/41 tests, 0 errors** a [GitHub Actions #42934477048](https://github.com/DavidParet/Primer-projecte/actions/runs/42934477048). Inclou proves que la ruta GET pública no revela dades i que un POST es rebutja **abans de llegir el cos o connectar a DB** si el pilot està desactivat.
- La configuració del projecte confirma `ssoProtection.enabled=false` només en aquesta **passarel·la**, sense tocar les proteccions SSO de `primer-projecte`.

**Secrets i control d'accés, verificats a Vercel:**
- `FORWARDING_PILOT_ENABLED=false` s'ha definit tant a preview com a producció. La comprovació final l'ha confirmat.
- `FORWARDING_PILOT_WEBHOOK_SECRET` és el secret del webhook **de proves desactivat**, `FORWARDING_PILOT_DATABASE_URL` apunta al rol restringit `nexlupa_resend_ingest` de la branca Neon aïllada, i `FORWARDING_PILOT_ENCRYPTION_KEY` és una clau independent per a la nova passarel·la. **Les tres estan a Vercel com a `sensitive`, només preview i només a la branca pilot.** No s'han desat claus a GitHub ni exposat els seus valors.
- **Atenció al desxifrat posterior:** la nova passarel·la té una clau d'embolcall **diferent** de la preview de l'app; el futur worker haurà d'utilitzar explícitament la clau corresponent o passar per una migració segura. No s'ha connectat cap worker real.

**Bloqueig verificat de desplegament:**
- El nou projecte està creat i les proves CI són verdes, però **encara té 0 deployments**. Un intent de preview Vercel ha retornat HTTP 402, límit `api-deployments-free-per-day` del pla Hobby. No s'ha ampliat cap quota, canviat el pla ni fet càrrecs.
- La connexió GitHub al projecte nou existeix, però **no s'ha verificat un URL públic funcional**. No afirmar que Resend pot enviar-hi POST fins que el desplegament estigui en `READY` i es comprovi la ruta real.
- El webhook de proves de Resend segueix `disabled` i **encara apunta a la URL de preview protegida anterior**, no a un endpoint del nou gateway. El webhook estable productiu continua sense canvis.
- **Pròxima fita estricta:** obtenir primer deployment `READY` de la passarel·la, provar GET públic sense autenticació i POST desactivat, després provar POST fictici signat amb família i consentiment de prova; només després repuntar el webhook **encara desactivat** i considerar-ne l'activació amb autorització i filtratge Gmail selectiu.

**Conclusió:** barrera pública aïllada creada, testada i configurada però encara **no publicada ni activada**. La producció NexLupa i les dades personals continuen fora del pilot.


### 11/11/2026 — passarel·la independent validada amb PostgreSQL i 50 proves

**Nova evidència de CI, sense credencials ni correus reals:** [GitHub Actions #42938252720](https://github.com/DavidParet/Primer-projecte/actions/runs/42938252720) finalitzat correctament, **45 proves offline + 5 proves amb PostgreSQL 16 efímer = 50/50 aprovades, 0 errors**.

- Test nou `gateway/tests/postgres.integration.cjs`, executat amb el **codi exacte de `gateway/lib/`**. Crea dades familiars inventades a una base PostgreSQL temporal, i utilitza un rol limitat que **no pot llegir la taula d'autoritzacions**.
- **12 POST HTTP signats concurrents** amb el mateix `email.received` fictici es dedupliquen en **una única fila xifrada**; el desxifrat amb AAD comprova la família i el destinatari correctes. Cap assumpte ni remitent es guarda a la cua.
- Signatura falsa: `HTTP 400`, sense inserció. Consentiment revocat o àlies desconegut: `HTTP 204` sense nou rebut ni accés a dades familiars.
- Les 45 proves aïllades també comproven que el servei OFF rebutja POST sense llegir el cos ni accedir al backend.
- Configuració d'aquest **projecte nou** ajustada via API Vercel per usar el subdirectori `gateway` i Node.js `22.x`, igual que CI. La resposta de Vercel confirma Node `22.x`, però no exposa el camp `rootDirectory` per una comprovació de lectura posterior; serà necessari verificar que efectivament desplega la ruta `gateway/api/webhook.js` quan la quota permeti un build.
- **Encara 0 deployments al projecte `nexlupa-forwarding-gateway`** després de l'última consulta. L'automatització puntual `NexLupa · Gateway preview` està programada per al 12/11/2026 a les 02:02 (Europe/Madrid), i farà **com a màxim un intent** si el servei segueix no desplegat. La comprovació de quota Vercel continua pendent.

**Portes que NO han canviat:** `FORWARDING_PILOT_ENABLED=false`, secrets sensibles només a preview, webhook pilot Resend desactivat, cap filtre Gmail, consentiment de família real no registrat i cap merge de PR. **50 proves no equivalen a un webhook de Resend rebut des d'Internet.**


### 11/11/2026 — primer desplegament READY de la passarel·la nova: TARGET PRODUCTION

**Novetat descoberta després de la validació de 50 tests:** Vercel ha creat automàticament un desplegament amb estat `READY` del projecte separat `nexlupa-forwarding-gateway`, ID `dpl_Pmu9qhnembjsTbuSVJW1SzTNS49L`, commit `8ed614198c8b4ec9fa077504bebf24e98a2740cf` de la branca `feature/gmail-resend-forwarding-pilot-20261110`.

- URL: `https://nexlupa-forwarding-gateway-d9xi81onu-davidparets-projects.vercel.app/api/webhook`.
- **Advertiment:** Vercel indica `target=production` **del projecte nou**, no `target=preview`. Això NO és el projecte principal `primer-projecte`; no s'ha publicat ni canviat l'aplicació familiar de producció.
- La consulta GET a través de l'eina Vercel retorna `HTTP 200` i exactament `configurationPresent:false`, `databaseConnectivityVerified:false`, `mode:"isolated-forwarding-pilot"`, `emailBodiesFetched:false`, `metadataReceiptsEnabled:false`, `productionEnabled:false`. Cap dada ni secret retornat. En ser un target de producció, `enabled()` **rebutja sempre** el processament encara que hi hagués una flag true. La flag `FORWARDING_PILOT_ENABLED=false` està confirmada també a production.
- La passarel·la nova té `ssoProtection.enabled=false`, però **encara no s'ha provat una connexió externa de Resend** ni un POST signat al desplegament, i la prova GET de l'eina amb credencials Vercel no demostra per si sola la connectivitat externa sense autenticació.
- La revisió `8ed6141` ja incorpora el codi del gateway i el primer test PostgreSQL; la suite de **50 tests correctes** correspon a un commit posterior `6d5974c77fd02c8b49560d06c29ec7fe3ffc286f` que afegeix el job CI. La ruta HTTP del gateway no ha canviat entre aquestes revisions.
- L'automatització de revisió `NexLupa · Gateway preview` (12/11/2026 02:02 hora local) s'ha **endurit** per exigir explícitament `requestBody.target="preview"` en qualsevol desplegament futur. Si la interfície rebutja aquest valor, té ordre de no reintentar sense target per evitar una altra publicació a `production`.
- El nou objectiu és obtenir **un deployment PREVIEW** vinculat a la branca pilot amb secrets `sensitive` limitats a preview i provar la recepció signada amb dades fictícies, sempre amb consentiment verificat. Cap webhook de prova de Resend s'ha activat ni ha canviat d'endpoint en aquesta ronda.

**Estat de seguretat:** PR #16 draft no fusionat, flag OFF, secret de signatura/xifrat/DB només a PREVIEW; production del gateway només allotja una ruta de diagnòstic i no pot processar correus, segons el codi verificat. La producció de NexLupa principal continua intacta.


### Auditoria operativa 11/11/2026 — aïllament i consentiment

- **Vercel — projecte exclusiu** `nexlupa-forwarding-gateway` (no el frontend principal): configurat `commandForIgnoringBuildStep` per construir **només** quan `VERCEL_ENV=preview` i `VERCEL_GIT_COMMIT_REF=feature/gmail-resend-forwarding-pilot-20261110`. Activada detecció de projectes afectats i exposició de variables de sistema al procés de construcció. Aquest filtre s'ha configurat, però **encara no s'ha validat amb un commit d'una altra branca posterior al canvi**. Els desplegaments cancel·lats per l'ignored build step poden continuar comptant a quota segons la documentació de Vercel. No modifica el frontend de producció ni promou desplegaments.
- **GET públic verificat a la preview** del commit `2ffa439`: HTTP **200**, `configurationPresent=false`, `databaseConnectivityVerified=false`, `metadataReceiptsEnabled=false`, `productionEnabled=false`, `emailBodiesFetched=false`. És una prova de ruta desactivada, no una prova de connexió real Neon via Vercel.
- **Neon (només branca de validació `br-dawn-salad-b9uhfz6u`, consulta SQL de lectura)**: `active_aliases=2`, `active_forwarding_consents=0`, `active_families=2`. **Hi ha 0 consentiments Gmail→Resend vigents; cap àlies és apta per a la ingesta real.** No s'ha creat cap consentiment ni alterat cap registre.
- **Rol Neon `nexlupa_resend_ingest` verificat**: EXECUTE de `resolve_authorized_recipient(text)` permès, INSERT a cua permès; SELECT a les taules de famílies i consentiments denegat. Consulta efectuada efectivament amb aquest rol i destinatari fictici desconegut → `NULL` (rebutjat).
- **Pròxima dependència de negoci/consentiment:** associar un nou àlies fictici de prova a una família pilot explícitament autoritzada abans de posar la flag en `true`, crear filtre Gmail o provar un POST signat que es guardi a Neon. No simular una aprovació de dades personals ni crear reenviament sense permís.
