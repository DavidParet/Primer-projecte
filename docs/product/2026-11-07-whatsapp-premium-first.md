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
