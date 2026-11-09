# NEXLUPA Premium — Fase 3: reenviar correu al receptor NEXLUPA
Data: 2026-11-07
Estat: prototip a GitHub, sense servei d'entrada real, sense desplegament.
Branca: `product/whatsapp-premium-20261107` · PR #4 en esborrany.

## Què ha definit la persona responsable del producte
Una família que té un Gmail personal rep una circular, la **reenvia al Gmail/adreça receptora de NEXLUPA**, i NEXLUPA n'identifica la família, l'associa amb la fitxa de l'activitat correcta i incorpora la nova informació. El mateix servei ha de poder rebre reenviaments des d'Outlook o qualsevol altre proveïdor que permeti reenviar missatges.

**Gmail personal OAuth no és un requisit** per a aquest flux. Google Calendar sí que requereix una connexió autoritzada per a l'actualització de l'agenda.

## Com funcionarà de cara a l'usuari
1. El compte familiar s'activa i verifica els seus correus reenviadors.
2. NEXLUPA proporciona una adreça individual de reenviament que arriba al mateix sistema receptor (p. ex. `entrada+<token-aleatori>@... `; exemple il·lustratiu, no existeix encara).
3. La persona reenvia la circular de Ball al receptor de NEXLUPA. No ha de connectar ni donar permisos sobre tota la seva bústia.
4. La recepció classifica el missatge segons les activitats de la seva família. Si només hi ha un destí clar, passa a la fitxa; si hi ha dubtes, queda pendent de classificació.
5. La fitxa unificada conserva el text i la font, fusiona comunicacions reenviades i WhatsApp, detecta rectificacions i prepara esdeveniments de Calendar amb permisos i controls.
6. L'usuari pot preguntar: «Fins quan hem de pagar el ball?» i rebre la resposta amb la circular com a font.

## Codi creat
- `lib/premium-forwarded-email.js`: un router intern de correus reenviats, no un servidor/webhook exposat. Exigeix resultat de verificació de transport i remitent per part d'un adaptador de confiança. Resol alias receptor únic, remitent familiar verificat, activitat candidata, text, adjunts i duplicats.
- Reconeixement del canal `email-forwarded` a `lib/premium-agent-pilot.js`, `lib/premium-ai-extractor.js` i `lib/premium-agent-pipeline.js`.
- `tests/run-premium-forwarded-email.js`: comprovació amb famílies simulades, dues activitats, remitent de família diferent, destinataris desconeguts, alias duplicats, correus dubtosos, adjunts, idempotència i conciliació a fitxa.
- `scripts/run-premium-prototype-tests.js`: ara agrega **set suites** de proves.
- Les sis suites actuals han passat en avaluació JS en memòria amb els fitxers de GitHub; el test de SHA-256 utilitza un hash de prova dins aquest entorn, no una comprovació criptogràfica del runtime Node. En Node real s'ha utilitzat `node:crypto` al codi.

## Seguretat i limitacions
**Aquest mòdul no és una frontera d'autenticació.** L'argument `verification` és una precondició que haurà de ser calculada per un adaptador real que comprovi la signatura del proveïdor i l'autenticació del remitent; no pot copiar-se mai de headers o JSON de l'emissor. El fet que un correu declari un `From` concret no basta per donar-lo per autèntic.

- Registre d'adreces receptores per família i reenviadors verificats. En producció els alias necessiten identificadors **aleatoris no endevinables**, rotació i desactivació.
- El mateix text reenviat dues vegades per una mateixa família dona una empremta estable. Canvis de signatura, adjunts o comentaris poden impedir la deduplicació i s'hauran d'abordar en la fase real.
- Sense classificació clara, el correu queda en revisió: **mai s'envia al compte d'una altra família** ni es vincula a l'activitat equivocada amb una coincidència feble.
- Missatges amb adjunts queden retinguts perquè encara no hi ha antivirus ni parser de PDF/imatges, i per tant no és correcte afirmar que NEXLUPA n'ha llegit el contingut.
- El primer extractor limita cada comunicació a **8.000 caràcters**; els reenviaments llargs requeriran segmentació segura abans de continuar.
- No existeix emmagatzematge persistent, reintents a cua, registre auditable, gestió de consentiment i esborrat de contingut familiar ni proteccions completes contra spam/abús.
- No s'han configurat correus reals, aliases a Google Workspace/Gmail, MX, OAuth, webhook, cap compte ni calendari.
- Les dades reals de menors i comunicacions de tercers no s'han de publicar a GitHub; aquest pilot només usa identitats i correus ficticis.

## Pla per connectar el receptor de debò
### Etapa A: decidir tecnologia de bústia
Pilot simple: una adreça de Gmail/Google Workspace de NEXLUPA amb aliases o plus-addressing, sempre que el servei i els encapçalaments de recepció permetin identificar correctament el destinatari. Alternativa de producció: servei de recepció de correu amb domini propi, parsing MIME, verificació del webhook, cues, reintents i eliminació segura.

**No s'ha verificat encara quina configuració de Gmail està disponible al compte de NEXLUPA** ni que la detecció del destinatari en tots els reenviaments estigui resolta.

### Etapa B: adaptar la recepció
Webhook/mailbox poll autoritzat: verificar origen, enregistrar ID de lliurament, resoldre alias i identitat familiar, escanejar adjunts, analitzar MIME, posar en una cua idempotent i cridar `routeForwardedEmail` només amb dades normalitzades.

### Etapa C: accions segures
Persistir fitxes amb aïllament de famílies, traçabilitat, correccions i esborrat. Integrar Google Calendar Premium amb permisos mínims, primer dry-run i confirmació de canvis sensibles. Mesurar correus ben assignats i percentatge de missatges enviats a revisió.

### Etapa D: prova amb famílies reals consentidores
Abans de fer promeses comercials: primer amb missatges sintètics lliurats realment al receptor, després amb una família consentidora, minimitzant dades i amb autoritzacions clares.

## Prohibicions vigents
No tocar web, preus, domini en producció, main, Gmail particular, WhatsApp particular ni Calendar real sense instrucció expressa. No confondre el funcionament del mòdul a GitHub amb disposar ja d'una adreça receptora pública.


## Ampliació de la fase 3 — bústia compartida de múltiples famílies
- `lib/premium-family-inbox.js`: orquestrador **només en memòria** que manté, per separat, els estats de diverses famílies, les fitxes de cadascuna de les seves activitats, les empremtes de reenviaments ja processats i una cua de metadades dels casos pendents de classificació.
- `tests/run-premium-family-inbox.js`: prova d'un lot de **6 correus ficticis**: tres comunicacions vàlides per a **dues famílies** i **tres fitxes** (Ball família A, Bàsquet família A, Ball família B), un missatge ambigu pendent de revisió, un reenviament repetit i un correu amb remitent incorrecte. Verifica els identificadors de Calendar separats i que no es repeteixin crides a l'IA per un reenviament duplicat.
- Una segona prova simula una fallada del proveïdor d'IA i comprova que no es marca com a processat el correu ni es modifica la fitxa original.
- Les **7 suites de regressió** s'han tornat a comprovar en un entorn JavaScript experimental. Les proves d'integració continuen fent servir clients d'IA simulats; no s'ha cridat un model real.
- **Limitació:** la cua i els estats viuen només en memòria. Encara no hi ha base de dades, receptor Gmail/SMTP, webhook segur, ni garanties de persistència i recuperació després d'una interrupció.
