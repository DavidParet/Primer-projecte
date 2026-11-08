# NEXLUPA — Resend, estat real i proper pas
**Data:** 7 novembre 2026 · **Àmbit:** pilot intern exclusivament. **No desplegar a producció**.
**Branca:** `product/whatsapp-premium-20261107`; PR #4 en esborrany.

## ESTAT VIGENT — 8 novembre 2026 (preval sobre les fotografies històriques d'aquest document)
**Domini de recepció** `entrada.nexlupa.app`: **VERIFIED** a Resend (`DKIM: verified`; `MX: verified`), regió UE. La web i l'MX del domini arrel continuen separats.

**Prova de correu real, contingut fictici**: Gmail → `pilot@entrada.nexlupa.app` → Resend: missatge `ce88e8c0-af25-4cb6-b472-c485acd1a6f2`, rebut el **08/11/2026 a les 17:42:35 UTC**. El text complet s'ha recuperat mitjançant el connector Resend. Conté **Ball**, assaig fictici **19/11/2026 17:00** i termini fictici **18/11/2026**; no fer-ne cap cita real.

**Webhook**: Resend ha notificat `email.received` (ID `msg_3LpnDOzEk6zKpv73iFb2NCRz9WJ`), estat **success**, **un intent HTTP 204** del pilot Vercel (08/11/2026 17:42:36 UTC). Aquest receptor **verifica i confirma** la notificació, però **no descarrega ni interpreta el missatge automàticament**, no persisteix fitxes ni escriu Calendar.

**Secrets**: auditoria actual sense revelar valors: el projecte aïllat Vercel **té `RESEND_WEBHOOK_SECRET` xifrat per a production**, però **no té `RESEND_API_KEY`**. L'afirmació antiga de «0 variables» més avall era una fotografia històrica i **no és vigent**.

**Adaptador SDK**: corregit el 08/11 el contracte de `resend.webhooks.verify` per transmetre `headers:{'svix-id', 'svix-timestamp', 'svix-signature'}` i `secret` com a paràmetre. Tests adaptats al mateix contracte. CI: https://github.com/DavidParet/Primer-projecte/actions/runs/42506398690 (**passa**). Això és un test sintètic del codi, no una prova amb SDK real.

**No operatiu encara:** processament automàtic de correus al backend, autenticació independent dels remitents, base de dades xifrada i transaccional, gestió de consentiment/retenció, registre real de famílies i agents amb IA real. Cap correu escolar real ni acció Calendar autoritzada. `main` i web pública intactes.

---

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


## Receptor HTTPS de prova aïllat — prova real completada (7/11/2026)
- Creat un projecte Vercel **independent** `nexlupa-resend-pilot`, ID `prj_SVHJJbNZk2kf6l4XNy1m6RCbGus4`. Sense connexió Git automàtica, cap domini `nexlupa.app` i cap impacte sobre el projecte web `primer-projecte`. El desplegament usa la destinació `production` **només del projecte pilot independent**, no pas la web corporativa.
- Endpoint: `https://nexlupa-resend-pilot-davidparets-projects.vercel.app/api/webhook`; desplegament confirmat **READY**: `dpl_2dv3WQeLT7SBd63Fbtsbp3PR1cjv`.
- Components revisats al repositori de desenvolupament: `pilot/resend-webhook/api/webhook.js` i `pilot/resend-webhook/lib/verify-svix.js`. Implementació Node nativa, verificació Svix del **cos sense reserialitzar**, HMAC SHA-256 amb comparació de temps constant, finestra de 5 minuts, mida màxima del payload i error tancat quan falta la clau.
- Webhook configurat al Resend real per **`email.received`**, ID `99ee8d6e-94e1-41ae-a9ef-e0a7408afa81`. Està habilitat.
- Secret retornat en crear el webhook i copiat directament a **variable xifrada** `RESEND_WEBHOOK_SECRET` al projecte Vercel pilot. **El valor secret NO està en cap fitxer, document ni missatge**. S'ha redeplegat el projecte perquè l'entorn el carregui.
- Segona prova real: Gmail va enviar un correu **completament fictici** a `pilot-nexlupa@pibnolee.resend.app`, rebut per Resend el 7/11 a les **15:18:00 UTC**, ID `dc589854-515d-451a-a1c4-9b57bff249f6`.
- Resend va registrar un esdeveniment `email.received` al webhook, **estat `success`**, ID `msg_3LmgVaFegd5o5qbEXUZXjn66pp9`, i la consulta d'intents confirma **1 enviament, HTTP 204**, 7/11 a les **15:18:01 UTC**. Queda acreditat el circuit real Gmail → Resend → webhook Vercel.
- GitHub Actions valida la suite nova de signatures `tests/run-premium-resend-webhook.js`, **15/15 proves** en verd: https://github.com/DavidParet/Primer-projecte/actions/runs/42385430810
- **Limitacions deliberades:** el webhook NO descarrega el correu, NO classifica famílies, NO envia dades a IA, NO desa fitxes, NO altera Calendar i NO envia res. No disposa de `RESEND_API_KEY`. Les proves del motor complet encara usen proveïdor i model simulats.
- Següent fase abans de qualsevol tractament de correus reals: API key de lectura guardada en secrets sense publicar-la; acreditació de remetents independent dels headers `From`; bústia/cua xifrada i idempotent, separació entre famílies, política de conservació i consentiment; provar pipeline amb missatges ficticis de punta a punta. **No activar públicament encara**.

**Conclusió verificable:** recepció real + notificació signada al servidor real **OK**; processament intel·ligent automàtic i estat persistent **PENDENT**.


## Entorn servidor Vercel i webhook: auditoria del 7/11/2026
- Es comprova a Vercel un projecte **separat** anomenat `nexlupa-resend-pilot`, no el projecte públic `primer-projecte`.
- El primer desplegament del pilot a Vercel és `READY`: ruta `/api/webhook` que declara verificació de signatura només; no processa correus, no escriu Calendar ni utilitza IA.
- Resend té **1 webhook habilitat** per a `email.received` apuntant a `https://nexlupa-resend-pilot-davidparets-projects.vercel.app/api/webhook`. Això **no acredita** recepció web end-to-end.
- L'auditoria de Vercel mostra **0 variables d'entorn configurades** en aquest projecte. Sense `RESEND_WEBHOOK_SECRET` no pot verificar esdeveniments reals.
- S'ha desenvolupat, en aquesta branca, una **segona variant deliberadament bloquejada** a `pilot/resend-vercel/` (status i webhook), sense credencials, amb verificació de signatura i resposta 503 per a `email.received` mentre manca cua durable. En cas de reinteig l'emissor conserva els correus al seu costat.
- Aquesta variant està **desplegada com a PREVIEW**, sense substituir el desplegament ni l'alias de producció del pilot: `https://nexlupa-resend-pilot-dyst7zdg8-davidparets-projects.vercel.app/api/status`. Vercel indica `READY`. La comprovació HTTP directa des del navegador automatitzat no s'ha pogut completar; **no confondre estat READY amb prova de resposta HTTP**.
- Les proves Node/GitHub Actions, incloent `tests/run-premium-resend-vercel-locked.js`, donen **16/16 suites PASS** al workflow https://github.com/DavidParet/Primer-projecte/actions/runs/42385551070.
- **No s'ha configurat el secret del webhook ni cap clau API al nou preview**: fer-ho ara podria comportar ACK abans d'emmagatzemar i autenticar correus. No s'ha creat cap cua privada ni activat processament continu.

**Pendent per considerar-lo actiu:** persistència xifrada, aïllament i registre de famílies real, attestació de remitents amb proves independents, idempotència transaccional, seguretat anti-replay, política de retenció i secrets allotjats al backend; només llavors provar correu fictici end-to-end i activar-lo.
