# NEXLUPA Agent — Fase 3: bústia universal per reenviament de correus
**Data:** 7 de novembre de 2026 · **Estat:** prototip intern, **sense correu real ni desplegament**.

## Decisió funcional confirmada
La família rep una circular al seu correu habitual (Gmail, Outlook o altres), la **reenvia a una adreça personalitzada de recepció NEXLUPA** i NEXLUPA l'associa a la fitxa de l'activitat corresponent. **No és necessari connectar tota la bústia personal de Gmail per fer servir aquest flux.**

Google Calendar és una connexió independent i expressament autoritzada. Les novetats de WhatsApp han d'alimentar la **mateixa fitxa**, no crear-ne una altra.

## Flux intern de la prova
1. Un servei receptor futur verifica el transport, la identitat del remitent i el destinatari. **Aquest servei encara no existeix.**
2. `lib/premium-forwarded-email.js` rep una representació interna d'un correu que *ja es considera verificat*.
3. Identifica la família per una adreça de reenviament única i comprova que el remitent està registrat com a reenviador autoritzat.
4. Reconeix Ball, Bàsquet, Teatre, etc. a partir de les fitxes registrades **d'aquella família**. Si el correu parla de diverses activitats o no es pot identificar-ne cap, el deixa pendent de revisió; no assigna a cegues.
5. Calcula un hash SHA-256 per evitar processar la mateixa circular més d'una vegada.
6. `lib/premium-family-inbox.js` separa les fitxes de cada família i evita barrejar identificadors de Calendar; manté una cua de revisió separada.
7. Les dades segures passen al prototip `premium-agent-pipeline`, que pot preparar una modificació de Calendar però **no l'executa**.

## Proves amb dades sintètiques
- Dos comptes familiars diferents, amb tres fitxes d'activitat en total.
- Circular reenviada des de remitent compatible amb Gmail i des d'un altre compatible amb Outlook.
- Nom de Ball coincident en diverses famílies: **fitxes separades**.
- Remitent no registrat, destinatari desconegut o suplantació declarada: **rebuig**.
- Dues activitats plausibles en un mateix correu: **revisió**.
- Adjunt encara no processat: **revisió**, mai anàlisi incompleta silenciosa.
- Segon reenviament de la mateixa circular: **duplicat**, sense repetir la trucada al model.
- Comprovació amb resposta simulada de model: termini de pagament amb font `email-forwarded` i una proposta d'actualització del Calendar sense escriptura.
- Les proves locals de `run-premium-forwarded-email.js` i `run-premium-family-inbox.js` han passat en un entorn experimental d'execució JavaScript.

## Limitacions CRÍTIQUES
- **No hi ha adreça real de NEXLUPA, bústia Gmail central, servidor SMTP, DNS/MX, webhook ni secret de proveïdor configurats.**
- El fet que un objecte del prototip porti `providerAuthenticated:true` **no és per si sol autenticació segura**; un futur adaptador ha de verificar de veritat la signatura del servei receptor i les credencials/remitents, sense acceptar aquesta marca des d'una petició de l'usuari.
- No s'han processat fitxers adjunts, PDF, HTML complex, àudio ni imatges. Cal parser MIME, límits, antivirus i estratègia de privacitat.
- Les fitxes són en memòria: no hi ha base de dades, polítiques de retenció, xifratge, còpies, esborrat ni multiusuari de producció.
- L'extractor d'IA no s'ha provat encara contra una API real. Les respostes dels tests són simulades.
- El prototip només prepara operacions de Calendar. No realitza OAuth ni escriptures.

## Proper pas
**Definir i verificar el contracte d'un proveïdor de correu entrant real**: domini d'entrada, alias per família, autenticació del webhook, controls antiabús, consentiment i retenció; després un pilot E2E amb comptes de prova i missatges ficticis, sense tocar `main` ni producció.

La branca continua en draft: `product/whatsapp-premium-20261107`. **No tocar la web ni els preus.**
