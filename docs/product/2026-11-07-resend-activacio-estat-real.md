# NEXLUPA — Resend, estat real i proper pas
**Data:** 7 novembre 2026 · **Àmbit:** pilot intern exclusivament. **No desplegar a producció**.
**Branca:** `product/whatsapp-premium-20261107`; PR #4 en esborrany.

## Fets verificats al compte connectat
- Connexió de ChatGPT amb Resend autoritzada i consultes reals d'API executades.
- Domini **`entrada.nexlupa.app`** creat a Resend, identificador `395bc642-cf3a-4306-8942-f8100fcdcf36`.
- Regió `eu-west-1`; capacitat de recepció habilitada, enviament desactivat.
- Estat de verificació del domini: **`not_started`**; falten registres DNS.
- Resend: **0 correus rebuts, 0 webhooks i 0 bústies** en la comprovació real.
- Límit consultat el 7/11: 100 correus al dia, 3.000 al mes, 3 dominis. No s'ha contractat cap pla de pagament.
- Intent de crear `pilot@entrada.nexlupa.app` amb `forwarding:true`: **HTTP 422**, "domain is not available for inbox creation". No s'ha creat cap bústia.
- Vercel confirma els nameservers autoritatius `dns1.registrar-servers.com` / `dns2.registrar-servers.com` i `zone:false`: **la zona DNS no es gestiona amb els registres DNS de Vercel**.
- **Cap canvi** als registres DNS externs, MX de Zoho, `lupa@nexlupa.app`, branca `main`, web, preus o dades de famílies.

## Criteri de desplegament
Primera preferència: fer prova de recepció **sense tocar el DNS** utilitzant l'adreça automàtica de Resend (`<prefix>@<identificador>.resend.app`). **No es coneix encara l'identificador real**, i no s'ha d'inventar. L'usuari o un navegador autenticat ha de consultar-la a **Resend → Emails → Receiving → Receiving address**. Les API connectades disponibles no exposen aquesta propietat directament.

Quan existeixi l'adreça real:
1. Enviar un únic correu de prova amb dades **totalment fictícies**; consultar `list_received_emails` i `get_received_email`.
2. Comparar el format real amb `lib/premium-resend-inbound.js`; provar separació de famílies, remitent autoritzat, deduplicació i cap modificació de Calendar.
3. Preparar endpoint HTTPS aïllat i cua xifrada per a `email.received`; verificar signatura amb el cos cru i no confiar en les instruccions dels correus.
4. Només si cal, verificar `entrada.nexlupa.app` amb MX **del subdomini `entrada`** a Namecheap, sense canviar MX del domini arrel ni Zoho.

**Precaució:** La integració actual amb GitHub té proves sintètiques satisfactòries, però cap flux de correu real end-to-end. La connexió de ChatGPT al compte Resend no equival a connexió desplegada del motor NEXLUPA.

## PROVA REAL DE RECEPCIÓ SUPERADA — 7 novembre 2026, 15:55 h (Madrid)
Captura autenticada de Resend: `<anything>@pibnolee.resend.app`. Adreça real emprada: **`pilot-nexlupa@pibnolee.resend.app`**.

- Gmail connectat va enviar **un correu de prova totalment fictici** amb assumpte `NEXLUPA PILOT — prova fictícia de recepció i extracció`; missatge Gmail `1a1b681c11245029`.
- Resend `list_received_emails`: **1 correu rebut**, ID de recepció `3fef615e-dedf-43ec-8034-7a0a6e305607`, hora `2026-11-07T14:55:24.671Z`.
- Resend `get_received_email`: **cos de text recuperat complet** via API autenticada, i metadades From/To/Subject coherents.
- El missatge inventat parla de l'activitat «Ball», un assaig el **17/11/2026 a les 18:00** i un termini fictici d'autorització el **18/11/2026**. Això és contingut de prova, **no un esdeveniment real** i no s'ha creat al Calendar.
- **Cap canvi DNS** ni a Zoho, cap dada real d'infants, cap activació pública.

**Abast demostrable:** Gmail real → Resend temporal real → consulta API autenticada i recuperació del cos real. **Encara no demostra** Resend → webhook NEXLUPA → classificació/extracció real automàtica → fitxa persistent. Les 13 bateries de tests del motor només proven el component d'integració **amb proveïdor i IA simulats**. El subdomini `entrada.nexlupa.app` continua `not_started` i no cal tocar-lo fins que l'experiment ho requereixi.

**Criteri actualitzat:** Utilitzar l'adreça temporal real i seguir amb una prova d'integració de recepció sense tocar els MX del domini corporatiu; no confondre prova d'entrada real amb producte operatiu.


## Pont intern Resend → fitxa familiar: afegit i provat
**Commit de proves:** `fa61e3672e5ae879ca7040387da3c947810ad9ff` · **GitHub Actions:** https://github.com/DavidParet/Primer-projecte/actions/runs/42384519515 · **14/14 suites PASS**.

- Afegit `lib/premium-resend-poll-worker.js`, interfície per `resend.emails.receiving.list()` i `receiving.get(id)` que alimenta `processForwardedEmail` del motor existent, **sense cap webhook ni endpoint públic**.
- Afegit `tests/run-premium-resend-poll-worker.js`: catorzena suite amb API i IA simulades. Comprova recuperació, classificació de fitxa, termini amb font, deduplicació, incidències API, verificació de remitent independent, bloqueig entre famílies i cap escriptura de Calendar.
- Integrada la prova al `scripts/run-premium-prototype-tests.js`; execució real de Node a GitHub Actions **superada**.
- La connexió de ChatGPT a Resend ja havia verificat **un correu real rebut i recuperat** a `pilot-nexlupa@pibnolee.resend.app` (apartat anterior).
- **No és encara un sistema automàtic:** el worker de `lib/` no s'executa amb un compte Resend real ni està programat; no hi ha clau API en secret manager, registre de famílies operatiu, persistència xifrada ni política real de comprovació d'identitat del remitent. `attestSender` falla tancat per defecte i les credencials de Resend no s'han de copiar a GitHub ni als xats.
- Per la connexió de producció cal backend independent amb secrets, processament segur i consentiment; no activar amb missatges escolars reals fins a tenir-ho.

**Decisió de seguretat:** branques de prova exclusivament; `main`, web, Zoho, Namecheap, Calendar, tarifes i serveis públics, intactes.
