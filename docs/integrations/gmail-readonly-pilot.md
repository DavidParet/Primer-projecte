# NexLupa — Primer pilot de Gmail (només lectura)

**Estat:** codi de preparació en una branca de GitHub. **No connectat a cap compte Gmail ni activat en producció.**

## Objectiu del primer pilot

Una família, un compte Gmail i una etiqueta de prova dedicada, per convertir correus escolars en propostes de fitxes pendents de revisió. No es poden enviar missatges, reetiquetar-los, esborrar-los ni crear esdeveniments automàticament.

## Peça tècnica preparada

El fitxer `lib/gmail/pilot.cjs` implementa:

- Autorització OAuth 2.0 amb `state` i PKCE (S256).
- Sol·licitud dels permisos `openid`, `email` i `https://www.googleapis.com/auth/gmail.readonly`. **Aquest últim és un scope restringit per Google.**
- Canvi del codi d'autorització per un token temporal; no retorna els tokens de renovació que el proveïdor pogués enviar.
- Consulta de fins a deu identificadors de missatges per una **etiqueta personalitzada** predefinida, no de tota la safata.
- Lectura de text pla, sense adjunts ni HTML i amb límits de mida; cada missatge es verifica novament perquè contingui l'etiqueta pilot abans de llegir-ne el contingut.
- Cap acció d'enviament, modificació o persistència de dades familiars.

### Vinculació segura i estat d'un únic ús

- `lib/gmail/oauth-flow.cjs`: només és invocable des del servidor i exigeix una sessió de família autenticada, la comprovació del consentiment, `state` d'un sol ús de 4 minuts, PKCE i verificació de l'adreça de Google.
- `lib/gmail/neon-intent-store.cjs`: guarda i consumeix l'estat mitjançant funcions SQL parametritzades. No pot accedir directament a les taules.
- La branca separada de Neon ja conté les funcions de prova `store_gmail_pilot_state` i `consume_gmail_pilot_state`; s'han comprovat els duplicats, consentiments revocats i usos repetits. **No estan desplegades en producció.**
- **94 proves executades i superades** en un entorn independent, sense dades reals: `node --test tests/gmail-*.test.cjs`.

**Important:** aquests mòduls no creen cap endpoint HTTP accessible. L'autenticació de famílies real encara no existeix i els secrets de Google no estan configurats.

## Requisits que encara falten per obrir la connexió

1. **Alta real de famílies dins NexLupa.** Neon Auth ja està provisionat en una branca aïllada, però encara no hi ha usuaris familiars verificats, vinculacions aprovades ni UI de login en producció.
2. **Google Cloud:** registrar l'aplicació de NexLupa, activar Gmail API i crear el client OAuth de tipus web, amb URI de retorn HTTPS exacta i pantalla de consentiment en mode de prova.
3. **Secrets:** incorporar `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET` al magatzem de secrets de Vercel, mai al repositori, fitxers públics o missatges de xat.
4. **Retorn OAuth segur:** integrar els mòduls ja provats amb l'autenticació real de família i un magatzem persistent de sessions; no acceptar identitats o permisos rebuts directament del navegador. No mostrar tokens al navegador.
5. **Etiqueta controlada:** etiquetar manualment uns missatges ficticis amb `NEXLUPA_PILOT`. Fer una única importació explícita; cap vigilància permanent ni lectura general de la bústia.
6. **Privacitat comercial:** preparar política de dades, retenció/revocació i verificació de Google abans de donar accés a famílies reals. Google classifica `gmail.readonly` com a permís restringit i l'avaluació de seguretat pot ser necessària quan se'n transmeten o desen dades en servidors.

## Decisions de seguretat

- Els headers `From`, `Subject` i el cos són dades no fiables; no decideixen a quina família pertany un missatge.
- El contingut del correu es tracta com **dades**, mai com a instruccions per als agents.
- Els fitxers de la branca no modifiquen `script.js`, `app/script.js`, `api/analyze.js` ni el desplegament principal.
- No confondre **la connexió Gmail de ChatGPT** amb un client OAuth independent per a NexLupa.

## Referències oficials

- [Google: Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google: OAuth 2.0 per a aplicacions web](https://developers.google.com/identity/protocols/oauth2/web-server)

## Estat de Neon Auth, 9 novembre 2026

- Neon Auth (Managed Better Auth) està activat només a la branca aïllada resend-worker-consent-validation-20261108 de la base nexlupa_pilot.
- Registre lliure amb email i contrasenya desactivat; verificació exigida en aquest mètode; localhost i organitzacions desactivats.
- Taula family_auth_memberships: relació explícita entre un usuari verificat de Neon Auth i una família activa; actualment cap usuari ni membre aprovat.
- Funció is_verified_gmail_family: exigeix pertinença, correu verificat, família activa i consentiment Gmail vigent.
- Funcions store_gmail_verified_state i consume_gmail_verified_state: estat temporal OAuth amb ID usuari, família, sessió i consum únic.
- Rol nexlupa_gmail_auth_preview: permisos limitats a funcions RPC, sense accés directe a les taules de famílies.
- Mòdul lib/gmail/verified-family.cjs: validació criptogràfica EdDSA contra JWKS, issuer fixat, expiració i rol, més comprovació de membres a Neon.
- API api/gmail/pilot-auth.js: preflight autenticat, no inicia OAuth i no llegeix Gmail.
- Mòdul lib/gmail/preview-import.cjs: consulta un màxim de 3 missatges únicament d'una etiqueta autoritzada, valida consentiment abans i després, descarta continguts no compatibles i retorna una previsualització per a revisió manual. No crida cap IA ni escriu a Neon, Gmail o Calendar.
- Secrets i configuració de Neon guardats exclusivament a Vercel preview del projecte independent de proves.

**Proves:** 94/94 superades en sandbox independent. Neon rebutja un usuari no vinculat a cap família.

**Bloqueig de desplegament:** Vercel retorna 402, codi api-deployments-free-per-day, per haver superat el límit diari de desplegaments per API. El preflight nou NO està desplegat. No s'ha modificat cap pla, factura, domini ni producció.

## Properes fites Gmail

1. Desplegar només el preflight quan la quota de Vercel torni a estar disponible.
2. Activar el login de Neon Auth en una pantalla pilot privada, verificar un compte i aprovar-ne explícitament la vinculació amb la família.
3. Configurar el client OAuth de Google Cloud, Gmail API i un redirect HTTPS exacte. Cap credencial en aquest repositori.
4. Afegir els endpoints start i callback, amb cookie efímera segura i comprovació de sessió, usuari, família i consentiment.
5. Fer una importació explícita amb correus ficticis marcats en una etiqueta pilot, sense lectura general de la bústia.

## Primer circuit de lectura sense efectes

La prova amb el simulador de Gmail ha validat aquest ordre: sessió familiar verificable → consentiment vigent → llista de màxim 3 missatges d'una etiqueta personalitzada → lectura de text pla, comprovant novament l'etiqueta → consentiment revalidat → previsualització pendent de revisió manual.

- La funció **no s'exposa com un endpoint HTTP**. Només la pot cridar l'orquestrador privat després del retorn OAuth Google verificat.
- Cada previsualització conté la procedència Gmail, una empremta estable de compte i missatge, l'assumpte i un extracte literal. No inventa imports ni dates, ni genera accions automàtiques.
- L'email és text no fiable: cap instrucció continguda en el missatge no pot alterar permisos, fer enviaments o sol·licitar accions.
- Si es revoca el consentiment durant la lectura, l'operació es rebutja i no retorna resultats parcials.
- **94/94 proves superades** (Node test, dades simulades) incloent 15 proves específiques d'importació.
- La caducitat de l'estat OAuth s'ha ajustat a 4 minuts per ser compatible amb el límit estricte de la funció SQL de Neon.

**Encara no fa extracció semàntica amb IA ni crea fitxes persistents.** Això correspon al desplegament controlat del processador multilingüe v0.9, amb revisió humana i comprovacions d'evidències.

## Autorització Google vinculada al navegador — etapa de desenvolupament

- `lib/gmail/browser-oauth.cjs`: crea una galeta efímera `__Host-nxl_gmail_state` amb Secure, HttpOnly, SameSite=Lax i caducitat de 4 minuts. La galeta no conté cap token de Google ni dades familiars.
- `lib/gmail/browser-intent-store.cjs`: consumeix la intenció OAuth comparant les empremtes d'estat i de galeta, mitjançant una única funció SQL restringida.
- `nexlupa_worker_rpc.consume_gmail_browser_state(text,text)`: creada únicament a la branca independent de Neon. Desactiva la reutilització amb `UPDATE ... RETURNING` i exigeix vinculació familiar i consentiment actius.
- `api/gmail/pilot/start.js` i `api/gmail/pilot/callback.js`: primera implementació de les rutes HTTP. Només s'habilitaran en una preview configurada amb `GMAIL_PILOT_ENABLED=true` i credencials Google pròpies. En producció estan bloquejades.
- `lib/gmail/private-server.cjs`: aplicació de permisos del rol restringit de Neon, JWT verificat i secrets de servidor.
- `lib/gmail/pilot.cjs`: identificació automàtica d'una etiqueta d'usuari amb nom exacte `NEXLUPA_PILOT`; sense aquesta etiqueta, no es llegeix cap missatge. La previsualització es limita a **tres** missatges i no modifica dades.
- `tests/gmail-browser-oauth.test.cjs`, `tests/gmail-browser-intent-store.test.cjs` i `tests/gmail-http-guard.test.cjs`: comprovació del retorn, vinculació al navegador, rebuig de tokens i estats invàlids, eliminació de galeta i bloqueig de la producció.

**Proves executades:** 94/94 correctes en sandbox Node, amb HTTP i respostes Google/Gmail simulades. S'ha validat a Neon que la nova RPC denega estats desconeguts i galetes incorrectes, i que els usuaris sense pertinença familiar no poden iniciar l'autorització.

**No confondre codi preparat amb integració activa:** encara falten el client OAuth de Google Cloud, el desplegament en una preview estable, un compte pilot verificat i la prova final amb consentiment real. Sense això, la ruta de connexió falla de manera segura i no llegeix Gmail.

### Configuració necessària únicament en preview

`VERCEL_ENV=preview`, `GMAIL_PILOT_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_PILOT_REDIRECT_URI=https://<domini-preview-estable>/api/gmail/pilot/callback`, `GMAIL_PILOT_DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`.

`GOOGLE_CLIENT_SECRET` i la cadena de connexió a PostgreSQL s'han de desar només com a secrets xifrats de Vercel; mai a GitHub. El domini d'inici i el retorn OAuth han de coincidir exactament per protegir la galeta `__Host-`. No activar el commutador fins que una persona autoritzada hagi aprovat el compte de prova, els permisos i la pantalla de consentiment.

## Seguiment de la primera prova integrada

- Nova bateria `tests/gmail-full-pilot-flow.test.cjs`: recorregut amb OAuth i Gmail simulats, dues notificacions escolars, consentiment revocat, etiqueta absent, reutilització del retorn i contingut no fiable.
- GitHub Actions ha executat correctament **94/94 tests** sobre la branca. No s'ha cridat Gmail real.
- Procediment exacte, passos Google Cloud i criteris d'acceptació a [`docs/integrations/gmail-pilot-runbook.md`](./gmail-pilot-runbook.md).
- A Vercel s'ha fixat explícitament `GMAIL_PILOT_ENABLED=false`, **només a preview**, per impedir qualsevol inici OAuth accidental fins al vistiplau del pilot.
