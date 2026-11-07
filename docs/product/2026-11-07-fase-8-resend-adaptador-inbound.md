# NEXLUPA — Fase 8: adaptador per a Resend Inbound
**Data:** 7 de novembre de 2026
**Estat:** prototip d'integració interna; **sense connexió al compte Resend de l'usuari**.
**Branca:** `product/whatsapp-premium-20261107` · PR #4 draft.

## Situació de partida
L'usuari ha iniciat un compte Resend i ha rebut un missatge de benvinguda. La pantalla d'Onboarding estava a `Add an API Key`: **no hi ha evidència de cap API key activa, webhook configurat ni de cap adreça receptora de prova descoberta**. El missatge de benvinguda no acredita cap d'aquests punts.

Històric documental de NEXLUPA: `lupa@nexlupa.app` era l'**àlies Zoho previst com a adreça pública universal**. La seva operativitat actual no s'ha verificat. **No modificar Zoho, el DNS ni els registres MX**.

## Arquitectura de Resend, verificada contra documentació oficial
1. Resend disposa d'una adreça de recepció de prova del tipus `<alias>@<id>.resend.app`; **l'identificador real del compte no és conegut**.
2. Un correu nou genera un webhook `email.received` amb **metadades** (ID, destinatari, remitent, assumpte, adjunts). **El cos complet no ve dins del webhook**.
3. El backend verifica la signatura sobre el **raw payload** amb `resend.webhooks.verify({payload,headers,webhookSecret})`, i capçaleres `svix-id`, `svix-timestamp` i `svix-signature`.
4. Després de verificar l'origen, crida `resend.emails.receiving.get(emailId)` per recuperar `text`, `html`, i informació d'adjunts.
5. Després d'autenticar **independentment** el remitent, la mateixa lògica NEXLUPA ja existent tracta el correu. No confondre la signatura de Resend amb un certificat que el pare/mare realment l'ha enviat.

## Canvis de codi
- `lib/premium-resend-inbound.js`
  - Valida l'esdeveniment amb la funció de verificació oficial del SDK **injectat**.
  - Només processa `email.received`; descarta altres esdeveniments.
  - Requereix un únic destinatari que coincideixi exactament amb un alias inscrit a una família.
  - Rebutja un reenviador no registrat, abans de recuperar el cos del correu.
  - Una funció d'autenticació externa `authenticateForwarder` és obligatòria per acceptar un missatge: per defecte falla **tancat** i el deixa a revisió.
  - Recupera el cos via `resend.emails.receiving.get(email_id)`, comprova coherència d'identificador, remitent, destinatari i assumpte entre webhook i API. Si hi ha discrepància, **revisió**.
  - **Adjunts no processats:** revisió explícita; res d'inferir que el missatge s'ha llegit sencer.
  - Envia comunicacions verificades a `processForwardedEmail`, el motor compartit amb Mailgun. **No es duplica la lògica de fitxes.**
  - Calendar continua en **mode proposta** sense escriptures.
- `tests/run-premium-resend-inbound.js` prova amb dades falses la signatura bona/falsa, cos per API, missatge duplicat, absència de prova independent de remitent, destinataris, metadades inconsistents, adjunts i fallades d'API.
- `scripts/run-premium-prototype-tests.js` incorpora el test nou.

## Proves
**13 bateries de regressió superades en Node.js 22 / GitHub Actions**:
https://github.com/DavidParet/Primer-projecte/actions/runs/42377249442

**Precaució:** el client Resend, la resposta de la seva API, la validació del reenviador i la IA es simulen dins dels tests. Encara no s'ha executat cap crida autentificada al compte Resend ni provat un webhook real.

## El que falta per passar a prova externa
1. Obtenir del **tauler Resend del compte** l'adreça receptora temporal exacta `<alias>@<id>.resend.app`. Aquest valor no apareix al correu de benvinguda i no es pot inventar.
2. Crear una API key de **proves amb permisos mínims** i desar-la al gestor de secrets de l'entorn de prova; no enganxar-la a cap xat, captura o GitHub. Si la interfície no ofereix clau d'abast mínim, revisar-ne el risc abans d'habilitar-la.
3. Preparar un **endpoint HTTPS segregat, no de producció**, amb verificació del secret webhook, cues d'esdeveniments duradores i resposta ràpida a Resend; no apuntar-lo al receptor Mailgun local.
4. Configurar un webhook `email.received` i desar el `whsec_...` al gestor de secrets, mai al repositori.
5. Afegir un verificador fiable de remitent i una quarantena; no confiar en `From` ni en cap capçalera d'autenticació del missatge sense evidència validada pel proveïdor.
6. Provar amb **correus ficticis** des de comptes controlats. No introduir comunicacions escolars o dades de menors al pilot fins que xifratge, consentiment, esborrat i política de retenció estiguin implementats.
7. Per usar més endavant `lupa@nexlupa.app`, caldrà decidir entre reenviament de Zoho o subdomini d'entrada segregat; **no traslladar els MX del domini principal** ni canviar els serveis existents.

## Fonts
- https://resend.com/blog/inbound-emails
- https://resend.com/changelog/managing-webhooks-via-api
- https://github.com/resend/resend-skills/blob/main/skills/resend/references/receiving.md
- https://resend.com/features/webhooks

**Producció intacta, sense correus enviats i sense contractar cap servei.**
