# NEXLUPA PREMIUM — WhatsApp First (especificació de producte)
Data: 2026-11-07
Estat: PROPOSTA PER VALIDAR. No implementat ni publicat.
Prioritat: ALTA, després de l'estabilització de desplegament i del motor.

## REORIENTACIÓ PRODUCTE — NOVEMBRE 2026: CAS PRINCIPAL = UN GRUP PER ACTIVITAT
**Decisió de producte de l'usuari:** no prioritzar les comunitats de 20 subgrups. El cas majoritari és **un únic grup de WhatsApp per activitat** (bàsquet, dansa, teatre, futbol). Premium ha de mantenir **automàticament actualitzada la fitxa de l'activitat i Google Calendar quan entra una comunicació**.

### Experiència objectiu, no capacitat ja desplegada
1. Configuració inicial senzilla: l'usuari vincula un grup/activitat («Bàsquet») i dona permís per connectar Google Calendar.
2. Quan arriba un nou avís **per un canal d'entrada realment disponible i autoritzat**, NEXLUPA l'analitza sense copiar ni enganxar.
3. Discrimina informació nova, rectificacions, cancel·lacions i conversa sense acció; reconcilia amb l'historial de la fitxa i les dades de Calendar.
4. **Fitxa viva**: horaris, dates, lloc, material, terminis, autoritzacions, pagaments i estat de pendents. Cada camp important inclou font, hora d'actualització i confiança.
5. **Calendar upsert**: crear si no existeix; modificar l'event correcte si ja existeix (usar `calendarEventId` persistent, recurrències i zona horària). Mai duplicar per cada missatge.
6. Alertar només dels canvis útils, i demanar confirmació de les dades incertes o de modificacions amb impacte. Accions rutinàries autoritzades es poden automatitzar; sempre desfer i registre auditable.
7. Opcional: resposta contextual preparada per WhatsApp. Cap resposta enviada a tercers sense aprovació explícita.
8. No cal tornar a consultar WhatsApp si l'avís s'ha incorporat correctament a la fitxa i calendari.

### Dependència tècnica imprescindible: com arriba el missatge
- **No prometre lectura passiva integral dels grups existents.** L'API oficial habitual de WhatsApp Business no permet connectar-se lliurement al grup escolar personal per llegir-ne totes les publicacions.
- Prioritzar investigació d'un client **Android natiu** amb consentiment revocable de notificacions; estudiar capturar **només les notificacions de les activitats autoritzades**, filtrant localment i sense transferir contingut d'altres converses. Cobertura parcial: les notificacions no són el registre complet del xat; no es poden prometre novetats silenciades, contingut ocult ni missatges antics.
- Mantenir via alternativa sòlida: reenviar missatges al WhatsApp oficial NEXLUPA (sense copiar/enganxar); per a clubs i escoles col·laboradors, recepció directa d'avisos.
- No confondre detectar una notificació amb tenir un missatge verificat; si la informació és parcial, sol·licitar revisió abans de canviar Calendar.

### Model mínim de fitxa
`Activity {id, familyId, name, sourceChannels[], timezone, calendarId, events[], tasks[], materials[], notes[], lastUpdate}`
`Event {id, activityId, calendarEventId, title, start, end, place, recurrence, status, sourceMessageIds[], confidence, revision}`
`Incoming {id, activityId, channel, timestamp, content, consentScope, processingStatus}`
- Idempotència per entrada, deduplicació semàntica i control de versions d'esdeveniment.
- Persistència segura entre dispositius i controls d'accés per família. Privacitat específica de dades de menors.

### Criteris d'acceptació (primer MVP Premium)
- Nova comunicació única en un grup de bàsquet → actualitza la fitxa.
- «Dijous 18 h» → «divendres 18 h» → edita **el mateix** event de Calendar, no en crea un altre.
- «Porteu samarreta blanca» → afegeix material/recordatori, no un segon entrenament.
- Conversa informal → cap avís ni actualització d'agenda.
- Rectificacions i cancel·lacions: conservar rastre i aplicar amb permís/confirmació adequada.
- Dades ambigües o incompletes → no modificar Calendar silenciosament.
- Sense autorització, o grup silenciat sense notificacions → no afirmar haver-ho monitorat.
- Prova E2E amb dades fictícies; després beta Android amb consentiment i mesura de cobertura.

**Ordre de prioritat:** (1) grup únic i fitxa viva + Calendar, (2) canal automàtic d'entrada viable, (3) respostes i seguiment, (4) comunitats amb múltiples subgrups com a funcionalitat avançada opcional.

---


## AGENT CONVERSACIONAL PREMIUM — RECUPERAT DE LES DECISIONS DE MAIG / JUNY 2026
**Decisió:** la fitxa viva i Google Calendar són també la base d'un agent familiar consultable en llenguatge natural. És una funcionalitat PREMIUM CENTRAL del MVP, **no una millora tardana**.
- Exemples: «Quin dia és la sortida de teatre?», «A quina hora hem d'arribar?», «Què hem de portar dissabte?», «Ja hem confirmat la plaça?», «Han canviat l'horari de l'entrenament?», «Què tenim pendent aquesta setmana?».
- L'agent consulta dades de la fitxa, cronologia de comunicacions que NEXLUPA hagi rebut lícitament, esdeveniments/tasques de Google Calendar que l'usuari hagi autoritzat, i Gmail si l'usuari l'ha connectat específicament.
- Fa cerca semàntica i resol conflictes i actualitzacions amb traçabilitat: un avís posterior verificat pot substituir l'horari anterior; una pregunta o rumor no s'ha de considerar canvi confirmat.
- Respostes breus amb data, hora, lloc, material i cita de la font concreta (canal, data/hora, missatge o fitxa), més una indicació de l'última actualització i grau de certesa.
- **No inventar informació**: si no consta la sortida, respondre «No he trobat una data confirmada als missatges rebuts ni a la fitxa», oferir revisar el missatge reenviat o preguntar al club. Mai afirmar que ha cercat directament dins del grup quan no té accés al seu historial.
- Consulta i lectura no requereixen confirmació addicional per cada pregunta dins dels permisos de l'usuari; enviar una resposta a tercers, tocar Calendar o modificar informació crítica segueix el control de permisos i confirmació configurat.
- Funció «Resol-ho»: després de respondre, proposar una acció («Afegeixo aquesta sortida al calendari?», «Preparo la resposta al responsable?»), que només s'executa segons les regles d'autorització.
- Mantenir minimització, aïllament per família, xifrat i esborrat; evitar exposar converses alienes al context autoritzat. No retenir ni cercar informació de grups no autoritzats.
- **Free:** consulta manual del contingut que s'acaba d'enganxar o pujar, si escau, sense monitoratge, historial sincronitzat ni consulta transversal a grups.
- **Premium:** pregunta a l'agent sobre el coneixement acumulat de les activitats i fonts connectades amb permís; historial i cerca transversal; accions i calendari integrats.

### Escenaris d'acceptació de l'agent
1. Missatge rebut: «Excursió divendres 20 de novembre a les 09:00, punt de trobada a la biblioteca». Pregunta: «Quin dia i a quina hora és la sortida?» → data/hora + punt de trobada + font.
2. Correcció posterior: «La sortida canvia a dissabte 21 de novembre a les 09:30» → l'agent prioritza la nova comunicació, identifica el canvi i conserva el rastre.
3. Missatges «Potser ho canvien» → no modificar cap data ni tractar la informació especulativa com a definitiva.
4. L'activitat no consta a les fonts autoritzades → «No he trobat la data», sense al·lucinacions.
5. Mateixa pregunta via web o WhatsApp oficial → mateixa informació, dins de les limitacions de missatgeria i permisos.
6. Dos fills amb activitats semblants → demanar l'aclariment mínim necessari en comptes de barrejar fitxes.
7. Dues fonts en conflicte → citar ambdues i demanar confirmació en lloc de canviar Calendar silenciosament.

### Prioritat efectiva de producte
1. Canal d'entrada autoritzat viable per a un únic grup d'activitat.
2. Fitxa viva i consolidació d'informació.
3. **Agent conversacional per preguntar al coneixement acumulat.**
4. Google Calendar sincronitzat amb control de canvis.
5. Respostes preparades i fluxos d'execució aprovats.
6. Comunitats amb molts subgrups: cas avançat, no MVP.
---

## Principi comercial
- FREE: l'usuari copia/enganxa text o puja captura; NEXLUPA analitza i mostra decisions, dates i tasques; límit just i transparent.
- PREMIUM: recepció amb el mínim de passos, processament automàtic, consolidació dels grups, agenda, recordatoris i respostes preparades, sempre amb permisos i control de l'usuari.
- Promesa: «NEXLUPA treballa per tu; tu només decideixes».
- No confondre "automàtic" amb llegir WhatsApp sense autorització: els grups personals i escolars existents NO són accessibles lliurement per tercers.

## Primer flux prioritari: reenviar a un contacte oficial de WhatsApp
1. Un pare/mare està dins un grup de WhatsApp de bàsquet, dansa, escola o extraescolars.
2. Selecciona un o diversos missatges i fa «Reenviar» al contacte oficial NEXLUPA.
3. Un número WhatsApp Business Platform, amb API oficial i webhook propi, rep només el material que l'usuari ha decidit reenviar.
4. NEXLUPA registra la recepció, normalitza text/imatges i demana categoria o grup només si no el pot identificar (la metadata d'un missatge reenviat no garanteix el grup d'origen).
5. Motor IA: descarta soroll, identifica accions, dates, canvis d'horari, obligacions, pagaments, material, ubicacions i terminis.
6. Desduplicació i comparació amb l'historial propi de la família; missatge nou no significa esdeveniment nou.
7. Proposa crear o modificar Google Calendar després de connectar el compte via OAuth; evita duplicats. Els canvis ambigües requereixen confirmació.
8. Envia una fitxa breu al contacte WhatsApp: què ha canviat, què cal fer, què s'ha preparat, botons d'aprovar/rebutjar si estan disponibles.
9. Si el missatge requereix resposta, genera esborrany i presenta opció d'enviament/revisió; no enviar res a tercers sense autorització explícita.
10. L'usuari pot desfer una actualització, eliminar els missatges emmagatzemats i configurar preferències per grup.

## Segon flux: Compartir → NEXLUPA (Android)
- Investigar PWA instal·lable amb web manifest share_target i service worker.
- En Android compatible, continguts compartibles d'altres apps poden obrir directament NEXLUPA; verificar amb WhatsApp real quin tipus de text/fitxers es pot compartir. No assegurar que tots els missatges permeten aquesta acció.
- Les imatges requereixen POST multipart i validació de tipus/mida; no inserir dades sensibles en paràmetres URL.
- iPhone: compatibilitat PWA share target no universal; reservar possible aplicació nativa o Share Extension després de validar demanda.

## Evolució Premium
- Conèixer les activitats i els membres de la família només amb dades autoritzades.
- Resum del dia/setmana amb filtre del soroll.
- Canvis detectats respecte de l'esdeveniment precedent, notificacions de qualitat («l'entrenament de dijous passa a divendres»).
- Recordatoris diferenciats per terminis, documents i material.
- Plantilles de respostes amb context i confirmació.
- Integració Gmail amb permisos separats per a missatges de correu; no barrejar automàticament identitats ni canals.
- Possibilitat de comunicacions estructurades directes des de clubs/centres participants, amb acord i consentiment, sense llegir grups privats.

## Límit real de WhatsApp: sense promeses falses
- El WhatsApp Business Cloud API permet rebre converses dirigides al número del negoci; no dóna accés general als missatges d'un grup escolar existent.
- La Groups API té condicions específiques, grups creats i gestionats via API i no equival a entrar a grups preexistents de famílies. No basar el model en aquest accés.
- No fer servir automatitzacions no oficials de WhatsApp Web, scraping o lectura de notificacions de tercers per eludir proteccions.
- Si l'usuari no reenvia els missatges, NEXLUPA no pot prometre observar els canvis d'un grup privat en temps real.
- No prometre resposta automàtica al grup d'origen.

## Seguretat, confiança i costos
- Permís explícit per connectar Google Calendar i enviar missatges; revisió abans d'accions externes.
- Minimitzar la retenció de text original; redactar i anonimitzar dades de menors quan sigui viable; xifrat, control d'accés i eliminació a petició.
- Mostrar sempre de quin missatge derivem una data o canvi, i comunicar incerteses abans de modificar agenda.
- Validar límits d'ús i autenticació al servidor, no al localStorage; límits d'imatges i antiabús.
- Cal estimar costos oficials de WhatsApp Business Platform i OpenAI per ús real abans de decidir el preu.
- No fer accessible docs/, configuracions internes ni missatges per URLs públiques.

## Proves d'acceptació indispensables
- Enviar 1, 5 i 20 missatges d'un grup de WhatsApp al contacte NEXLUPA sense copiar/enganxar.
- Entrades repetides: un sol esdeveniment a Calendar, no 5.
- «Dijous 18 h» → «divendres 19 h» modifica el correcte, amb confirmació quan sigui necessari.
- Un missatge de conversa informal no crea cap tasca.
- Diferenciar data d'activitat de data límit per pagar o autoritzar.
- Captura o foto amb dades: OCR/visió i verificació de dates.
- Si es desconeix el grup d'origen, demanar assignació simple; mai atribuir-lo inventant.
- Error de WhatsApp, OpenAI o Google: recuperació segura, sense duplicar accions.
- Permís revocat: deixar de processar/actualitzar.
- Proves reals Android/iOS i navegadors abans de prometre UX universal.

## Seqüència d'implementació suggerida
A. Estabilitzar desplegament i motor actual; tests de regressió.
B. Prototip WhatsApp Business contact + webhook amb missatges de prova anonimitzats; resposta resumida.
C. Historial i reconciliació d'esdeveniments + OAuth Google Calendar + accions amb confirmació.
D. Opció Android «Compartir → NEXLUPA» amb PWA instal·lable, si les proves amb WhatsApp ho permeten.
E. Resums, notificacions, respostes suggerides, controls i sistema de subscripció.
F. Beta amb famílies i dades reals consentides, mètriques de temps estalviat i fiabilitat; després llançament.

Criteri d'èxit: mesurar passos humans, temps estalviat, canvis correctes de Calendar, falsos positius i incidències de privacitat. Premium ha de reduir molt clarament la feina, no només augmentar la quota d'anàlisis.


## Cas real prioritari: comunitat de teatre amb 20 subgrups — filtratge de pertinència
**Problema expressat per l'usuari (novembre 2026):** cal entrar constantment a WhatsApp Teatre i llegir anuncis per determinar si una novetat afecta el subgrup propi entre uns 20 subgrups. Això crea sobrecàrrega i fa que es perdin canvis importants.

### Producte desitjat
- Configuració inicial mínima: el pare/mare tria l'activitat «Teatre» i identifica **el seu subgrup**, nom/sinònims, edat/curs i, si escau, horari habitual.
- NEXLUPA diferencia entre avisos generals (que afecten tothom), avisos exclusius d'altres subgrups, i avisos específics del subgrup propi. **No és suficient filtrar pel nom del xat**, perquè una comunitat pot posar anuncis de 20 grups al mateix espai.
- Fer servir context semàntic, no només paraules exactes: «grup 4», «dijous 18h», «els grans», canvis de denominació, etc. Quan la confiança és insuficient, demanar verificació i no descartar silenciosament possibles avisos importants.
- Evitar notificacions de soroll, donar **avisos només quan són rellevants**: canvis d'horari, material, actuacions, autoritzacions, pagaments, canvis de lloc, terminis.
- Mostrar fonts i raó de pertinència: «Afecta Teatre - grup 4, perquè el missatge menciona aquest grup i el nou horari». Mantenir historial i actualitzar calendari sense crear duplicats, amb confirmació quan calgui.
- Oferir un resum opcional «La resta de missatges no afecten el vostre grup» sense revelar dades privades de grups no seleccionats.

### Viabilitat i límits
- WhatsApp Communities agrupa grups i té canal d'anuncis per tota la comunitat; els anuncis de la comunitat poden barrejar informació de 20 subgrups.
- NEXLUPA **no pot entrar de manera silenciosa i llegir tot l'historial de grups privats** a través de WhatsApp Business Cloud API.
- Via potencial Android: aplicació nativa i NotificationListenerService amb permís informat i revocable, que permet accés a notificacions noves del dispositiu, no a tot el contingut de WhatsApp. Les notificacions de grups silenciats o que no apareguin, els fitxers o els missatges llargs poden no arribar íntegres.
- Aquest permís és ampli a nivell Android: filtratge estricte local només dels grups escollits, no transmetre notificacions d'altres xats, controls de privacitat per dades de menors i prova prèvia de requisits de Google Play.
- Alternativa fiable per cobrir omissions: reenviament puntual al contacte oficial NEXLUPA o integració amb el centre de teatre (publicació consentida d'avisos estructurats directament a NEXLUPA).
- No prometre detecció 100% ni actualització de Calendar a partir de notificacions incompletes; en cas de dubte, avisar i demanar revisió.

### Proves d'acceptació
- 20 subgrups simulats, 100 anuncis: detectar tots els avisos generals i específics del subgrup seleccionat; no crear alertes d'altres subgrups.
- Mencions indirectes i canvi de nom del subgrup; evitar falsos negatius de novetats crítiques.
- Canvi d'hora d'una actuació: modificar l'esdeveniment existent a Google Calendar, amb identificació de l'origen i confirmació abans de fer canvis si la font és ambigua.
- Validar amb notificacions reals Android, incloent comunitats, grups silenciats, missatges llargs, ocultació de contingut, iOS i configuracions de privacitat; mesurar cobertura i descartar l'automatització passiva quan no sigui prou fiable.


## DECISIÓ PRODUCTE — FONT DOBLE (GMAIL OFICIAL + WHATSAPP INFORMAL) EN UNA ÚNICA ACTIVITAT
**Requisit expressat per l'usuari (7 de novembre de 2026):** per exemple, les comunicacions de Ball arriben per **dues vies simultànies**: un correu més formal i un grup de WhatsApp amb canvis i aclariments informals. L'agent Premium no ha de separar-les en dues activitats; ha de fusionar-les de manera segura dins una única fitxa viva i Google Calendar.

### Flux de referència
- L'escola envia un **email oficial**: «Festival de Ball dissabte a les 17:00 al Teatre Municipal».
- El monitor envia un **WhatsApp** posterior: «Les nenes han d'arribar a les 16:15, ja vestides».
- NEXLUPA identifica que les dues comunicacions parlen del mateix festival i **conserva tant l'hora de l'actuació (17:00) com l'hora de convocatòria (16:15)**. No substitueix una per l'altra.
- La fitxa manté activitats, fonts de cada camp, estat, materials, arribada, acte, terminis i canvis; l'agent respon «A quina hora hem de ser al teatre?» → 16:15, citant el WhatsApp; «A quina hora comença?» → 17:00, citant el correu.
- Google Calendar conté **un sol esdeveniment de festival** amb inici de l'acte i una anotació/recordatori d'arribada; si l'usuari prefereix registrar també la convocatòria com a esdeveniment independent, és una opció de configuració, no un duplicat involuntari.

### Regles de reconciliació multicanal
1. Normalitzar tots els missatges autoritzats a la mateixa entitat `Activity` i vincular-los amb `sourceChannel = email|whatsapp`, `sourceId`, emissor, data/hora de recepció i fiabilitat.
2. Entendre **la semàntica del camp**: hora d'inici, hora de convocatòria, hora de sortida, termini de pagament, hora de recollida i recordatori són camps diferents.
3. **La formalitat no és una regla automàtica de preferència.** El correu pot ser oficial però anterior, i WhatsApp pot rectificar-lo legítimament. Conservar l'historial de versions i mostrar el motiu de l'elecció.
4. Si una comunicació rectifica una dada que ja existeix, analitzar si és una correcció explícita i si l'emissor està autoritzat. Si és ambigu o contradictori, marcar `needsReview` i no sobreescriure Calendar silenciosament.
5. Deduplicació per IDs originals d'email/WhatsApp quan n'hi hagi, més desduplicació semàntica entre canals; **una activitat i un esdeveniment, no dos perquè han arribat per canals diferents**.
6. Actualitzar Google Calendar amb permisos OAuth limitats, referència persistent `calendarEventId`, traçabilitat, confirmació per rectificacions amb impacte i capacitat de desfer.
7. La fitxa ha d'indicar «Última novetat de WhatsApp» i «Circular oficial de Gmail» amb links només quan l'accés de l'usuari ho permeti; no fer accessibles textos o identificadors privats a tercers.
8. L'agent de consultes utilitza tant el correu com els missatges WhatsApp **realment rebuts**; ha de declarar quan no pot verificar si un grup té missatges més recents perquè l'accés no és complet.
9. **Cobertura per canals:** Gmail connectat es pot sincronitzar amb permisos; grups privats preexistents de WhatsApp no poden ser llegits completament per l'API Business habitual. No prometre unificació completa sense una entrada de WhatsApp validada i legítima.

### Escenaris de prova obligatoris
- Correu oficial crea acte; WhatsApp afegeix hora d'arribada i vestuari: un sol acte al calendari.
- Email i WhatsApp repeteixen el mateix lloc i hora: sense notificació duplicada.
- WhatsApp canvia explícitament l'hora d'inici anunciada a Gmail: proposar modificació al mateix `calendarEventId` i confirmar si cal.
- WhatsApp fa referència a «quedar a les 16:15» sense especificar si és convocatòria o canvi d'acte: no substituir les 17:00 de Gmail.
- Email posterior que contradiu WhatsApp: ordenar per evidència, tipus de dada i autoritat real, no pel canal; demanar confirmació quan no hi ha certesa.
- L'agent respon preguntes concretes sobre convocatòria, material, inici de l'acte, lloc i pagaments, amb font i dates.
- Si WhatsApp no s'ha pogut sincronitzar, informar que es respon només amb les dades disponibles.

**Prioritat:** la conciliació Gmail + WhatsApp s'inclou des del primer MVP Premium de fitxa viva; el filtratge de múltiples subgrups continua sent un cas avançat, no el flux principal.


## AGENT FAMILIAR PREMIUM — CONSULTES EN LLENGUATGE NATURAL AL MOMENT (REQUISIT CENTRAL)

**Decisió de producte, 2026-11-07:** l'usuari vol un agent disponible en tot moment per resoldre qualsevol dubte de la vida familiar utilitzant les dades que NEXLUPA té autoritzades. No és una funció menor: és la **interfície principal de Premium** al costat de l'automatització de comunicacions.

### Experiència que ha d'oferir
- Xat conversacional en català (i altres idiomes segons l'usuari), accessible en una única pantalla mòbil, amb preguntes normals i seguiment contextual: «Quan és la sortida de ball?», «A quina hora hem de ser-hi?», «Què han de portar?», «Què falta pagar?», «Hi ha hagut algun canvi avui?».
- Cerca en **una fitxa viva unificada per activitat**, informació realment rebuda per Gmail i WhatsApp, historial de canvis, tasques pendents i esdeveniments de Google Calendar autoritzats.
- Resposta **breu i accionable**, amb font i data de l'última comunicació. Diferenciar «hora d'arribada» d'«hora d'inici» i altres camps; no inventar informació.
- Si una dada és contradictòria, incompleta o anterior a una rectificació, **mostrar la incertesa i demanar verificació**. Si NEXLUPA no ha rebut tots els missatges de WhatsApp, no insinuar que disposa d'un historial complet.
- Suggerir i preparar accions immediates: «Afegeix el material al recordatori», «Actualitza el calendari», «Prepara un WhatsApp per confirmar assistència», «Mostra'm el missatge original».
- **Confirmació abans d'enviar missatges a tercers** o executar canvis no trivials; els canvis de calendari habituals només s'automatitzen després de permisos concrets i revisables.
- Resposta ràpida a consultes indexades: cerca per família, activitat, data, acció, emissor, source message i calendarEventId. No és obligatori fer una trucada al model per recuperar una dada estructurada inequívoca.
- Permetre seguiment: «I a quina hora?», «Qui ho ha comunicat?», «És segur?», «Ja ho tenim apuntat?», i correccions explícites de l'usuari amb historial.
- Separar coneixement general de dades particulars: si l'usuari pregunta una cosa que NEXLUPA no sap a partir de fonts autoritzades, respondre honestament i, si escau, oferir passos per verificar-ho.

### Arquitectura proposada
1. Ingesta legítima dels canals autoritzats i informació aportada manualment.
2. Normalització, deduplicació i reconciliació en fitxes i esdeveniments canònics.
3. Índex de cerca familiar amb identitat de cada font, permís i procedència; dades no accessibles entre famílies.
4. Agent amb eines amb permisos separats: consultar fitxes, cercar fonts, llegir Google Calendar, crear/editar propostes d'esdeveniments, preparar respostes.
5. Regles de decisió i traçabilitat: resposta fonamentada, estat de confiança, font més recent, què s'ha actualitzat i què requereix aprovació.
6. Avaluació de rendiment i privacitat: objectius mesurables de latència, cost per consulta, exactitud i falses afirmacions.

### Conversa d'exemple (dades fictícies)
Usuari: «NEXLUPA, quan és la sortida de ball?»
Agent: «Dissabte 21 de novembre. L'acte comença a les 17:00, però heu d'arribar a les 16:15 amb el vestuari posat. Ho indica la circular de Gmail i un missatge posterior de WhatsApp. Ja consta al calendari.»
Usuari: «Què hem de portar?»
Agent: «El vestuari de ball posat. No tinc confirmat cap altre material.»
Usuari: «Prepara una resposta de confirmació.»
Agent: prepara l'esborrany i l'ofereix per revisar; no l'envia sense autorització.

### Proves d'acceptació
- 10 consultes amb respostes repartides entre Gmail, WhatsApp i Calendar; totes amb fonts precises.
- Informació contradictòria: l'agent no escull silenciosament una dada falsa ni confon convocatòria amb actuació.
- Consultes de seguiment sense repetir tota la pregunta inicial.
- Una petició d'edició del calendari identifica un sol esdeveniment existent i no duplica.
- No consulta xats no autoritzats, no envia missatges sense aprovació i no exposa dades d'una família a una altra.
- Quan falta accés a un canal, ho diu clarament.

**Estat:** visió i requisits de producte; ni l'agent multicanal ni les integracions de WhatsApp han estat implementats encara.
