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
