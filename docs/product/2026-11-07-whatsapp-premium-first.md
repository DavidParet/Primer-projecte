# NEXLUPA PREMIUM — WhatsApp First (especificació de producte)
Data: 2026-11-07
Estat: PROPOSTA PER VALIDAR. No implementat ni publicat.
Prioritat: ALTA, després de l'estabilització de desplegament i del motor.

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
