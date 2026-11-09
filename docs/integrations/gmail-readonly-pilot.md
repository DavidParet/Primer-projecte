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

- `lib/gmail/oauth-flow.cjs`: només és invocable des del servidor i exigeix una sessió de família autenticada, la comprovació del consentiment, `state` d'un sol ús de 5 minuts, PKCE i verificació de l'adreça de Google.
- `lib/gmail/neon-intent-store.cjs`: guarda i consumeix l'estat mitjançant funcions SQL parametritzades. No pot accedir directament a les taules.
- La branca separada de Neon ja conté les funcions de prova `store_gmail_pilot_state` i `consume_gmail_pilot_state`; s'han comprovat els duplicats, consentiments revocats i usos repetits. **No estan desplegades en producció.**
- **36 proves executades i superades** en un entorn independent, sense dades reals: `node --test tests/gmail-*.test.cjs`.

**Important:** aquests mòduls no creen cap endpoint HTTP accessible. L'autenticació de famílies real encara no existeix i els secrets de Google no estan configurats.

## Requisits que encara falten per obrir la connexió

1. **Autenticació de famílies dins NexLupa.** El repositori actual no acredita encara la identitat de la família per vincular-hi un compte Google. El paràmetre `state` d'OAuth no substitueix aquesta autenticació.
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
