# NEXLUPA — Activació del proveïdor de correu: accions del titular
Data: 2026-11-07
Estat: **preparació; NO activat; NO correus de tercers**.
Treball només a la branca `product/whatsapp-premium-20261107`.

## Punt de partida comprovat
- Domini **nexlupa.app** identificat al compte Vercel del projecte `primer-projecte`.
- S'han trobat `app.nexlupa.app`, `www.nexlupa.app` i `nexlupa.app` vinculats al projecte.
- Els servidors DNS declarats són `dns1.registrar-servers.com` i `dns2.registrar-servers.com`: **no assumir que els canvis DNS es gestionen a Vercel**; cal fer-los al proveïdor que gestiona la zona autoritativa.
- Cap DNS no s'ha canviat, i cap domini/subdomini de correu s'ha activat.
- El codi de Mailgun existent és un prototip **local i amb dades sintètiques**. No és apte per rebre correus de persones reals, ni per desplegar encara.

## Proveïdor proposat per al pilot
**Mailgun Free** (no subscripció de pagament). A 2026-11-07, el centre d'ajuda oficial indica sense targeta, 100 missatges diaris, un domini personalitzat i una ruta d'entrada. Verificar les condicions exactes durant el registre.
- https://help.mailgun.com/hc/en-us/articles/203068914-What-does-the-Free-plan-offer
- https://help.mailgun.com/hc/en-us/articles/203637190-How-can-I-add-or-delete-a-domain
- https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview

## Úniques accions que ha de fer el titular ara
1. Obrir **https://www.mailgun.com/** i crear un compte (si les condicions i l'edat requerida ho permeten), amb un correu sota el seu control i **pla Free**. No contractar cap pla de pagament.
2. Validar el correu i activar **2FA/MFA** si el tauler ho ofereix.
3. A `Sending → Domains → Add new domain`, registrar **entrada.nexlupa.app**, regió **EU** (Europa). Aquest subdomini és només de recepció i evita alterar els MX del domini principal. La documentació oficial permet seleccionar la regió quan s'afegeix el domini.
4. **Aturar-se quan aparegui la pàgina amb els registres DNS necessaris.** No enganxar API keys, Webhook Signing Keys, credencials ni cap missatge familiar a ChatGPT o GitHub.
5. Fer arribar només **una captura dels registres DNS (MX/TXT, sense cap secret)** o la llista de tipus, nom, valor i TTL. Amb això podem preparar la modificació DNS exacta i comprovar que no afectarà la web.

## Accions tècniques de NEXLUPA després de la captura
- Revisar els registres exactes que Mailgun mostra per a la regió EU. No barrejar MX nord-americans amb els europeus.
- Preparar els canvis **només de `entrada.nexlupa.app`** al panell DNS del registrador. El titular haurà d'autoritzar explícitament qualsevol escriptura DNS.
- Després, preparar un endpoint HTTPS segregat, signatura de webhook i reenviament de correus amb una cua segura, xifrada i persistència atòmica.
- Comprovar una regla `Receiving → Routes` amb 1 ruta per alias/sistema si s'escull Mailgun Free.
- No provar amb circulars reals ni dades de menors fins que la política d'autenticació, la retenció i l'esborrat estiguin implementats.
- Només després del pilot segur, provar Gmail i Outlook amb correus completament ficticis.

## Advertiments
- **No canviar els MX de `nexlupa.app`** ni els de cap servei de correu existent. Només el subdomini preparat.
- Seleccionar **regió EU** des de l'inici. Mailgun documenta missatges i rutes regionalitzades; informació de compte pot replicar-se globalment.
- No crear la ruta externa apuntant al receptor local: aquest només escolta en loopback i encara no és un servei segur de producció.
- L'actual endpoint prototip no processa PDF o fitxers adjunts.
- Si el registre de Mailgun demana pagament, selecció d'un pla de prova amb cobrament o un subdomini que no es pot crear, **no acceptar cap càrrec** i revisar alternatives.

Fonts:
- https://help.mailgun.com/hc/en-us/articles/203068914-What-does-the-Free-plan-offer
- https://help.mailgun.com/hc/en-us/articles/203637190-How-can-I-add-or-delete-a-domain
- https://help.mailgun.com/hc/en-us/articles/360011565514-DNS-frequently-asked-questions
- https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview
