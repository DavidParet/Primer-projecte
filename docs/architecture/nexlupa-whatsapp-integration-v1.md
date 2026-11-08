# NexLupa — WhatsApp: arquitectura de la prova pilot (v1)
**Data:** 2026-11-08  
**Estat:** prova tècnica aïllada; no és una integració real activada  
**Àmbit:** missatges ficticis d'extraescolars, comprovacions de grups i famílies diferents; cap conversa real ni credencials.

## 1. Resultat que volem
Una família rep missatges desordenats, canvis d'hora, terminis, materials i preguntes repetides en un grup escolar. NexLupa ha de crear una **fitxa viva per activitat**, amb dades contrastables, fonts i canvis, consultable amb preguntes naturals:
- «A quina hora sortim finalment?»
- «Què cal portar?»
- «Fins quan tenim per pagar?»

No hem de prometre llegir automàticament els grups preexistents de WhatsApp.

## 2. Límits reals de WhatsApp (verificar abans de cada llançament)
- **Cloud API (WhatsApp Business Platform):** permet missatges adreçats al número empresarial de NexLupa, amb consentiment i webhooks. **No és una API que connecti lliurement els xats privats i grups escolars existents.**
- **Groups API empresarial:** existeix, però té requisits d'elegibilitat específics i grups petits; no serveix per accedir als grups grans d'AMPA ja creats.
- Cap integració basada en lectura oculta del telèfon, automatització de WhatsApp Web amb sessions personals ni scraping: risc de bloqueig, privadesa i dependència fràgil.
- Fonts de context: WhatsApp Business Platform (whatsappbusiness.com), documentació Meta (developers.facebook.com), estat Groups API revisat el novembre de 2026.

## 3. Entrada de missatges: ordre de prioritat
**Free:** l'usuari copia/enganxa un text o adjunta una captura, amb 3 lectures/dia.

**Premium (primera versió viable):**
1. L'usuari reenvia voluntàriament a un xat 1:1 amb un número empresarial NexLupa (quan estigui configurat i autoritzat), o bé comparteix text/captura a l'aplicació per un flux suportat pel dispositiu.
2. Receptor oficial amb webhook autenticat (pendent); dades associades a compte i família amb permisos explícits.
3. Pseudonimització, classificació per grup i activitat, deduplicació, extracció de dates/pagaments/materials i proposta d'actualització.
4. Fitxa viva: confirma canvis, conserva evidència i presenta preguntes contestables.
5. Google Calendar **només després de confirmació de l'usuari**, prevenint duplicats.

**Agent (tercer nivell):** consulta fitxes, prepara respostes i executa tasques autoritzades; per a canvis importants demana aprovació.

> Nota: un reenviament a un número empresarial no permet automàticament saber de quin grup prové. Cal associar el grup manualment o per una regla explícita del compte. L'usuari no ha d'afegir el bot al grup escolar.

## 4. Canals i pipeline
WhatsApp reenviat / text compartit / captura / Gmail → ingesta autoritzada → normalització → extracció IA amb fonts → reconciliació d'esdeveniments → fitxa viva → consulta i confirmació → Calendar / resposta.

- **Missatge:** id, data/hora, remitent pseudonimitzat, contingut o multimèdia pendent; la zona horària de l'export no està garantida.
- **Fet:** groupId, topic, field, value, at, sourceId, confidence, operation.
- **Claus de fusió:** família + grup + activitat + camp. Famílies/grups diferents no es poden barrejar.
- **Operacions:** set = dada nova; correct = rectificació explícita; cancel = anul·lació.
- Una dada nova contradictòria sense rectificació explícita queda **needsReview**, i no sobreescriu automàticament el valor vigent.
- Les dades amb confidence distinta d'explicit no s'apliquen. La UX futura les ha de mostrar com a pendents de revisar.

## 5. Què aporta aquest PR
- lib/whatsapp/pilot.js: parseWhatsAppExport() admet els formats comuns Android i iOS en català/castellà/anglès (export de text), amb missatges multilínia, pseudònims P1/P2, límit de mida, identificadors i multimèdia no llegida marcada pendent. No consulta internet ni guarda dades.
- reconcileFacts(): reconciliació determinista amb deduplicació per sourceId, historial de canvis i marques de revisió.
- lib/whatsapp/activity.js: listActivityCards() prepara fitxes vives aïllades per família/grup/activitat i getActivityFact() retorna valor, fonts i estat (confirmat, pendent, cancel·lat o desconegut).
- tests/whatsapp-pilot.test.js i tests/whatsapp-activity.test.js: 11 comprovacions sintètiques de parser, deduplicació, correccions, consultes i aïllament per família.
- .github/workflows/whatsapp-pilot-tests.yml: execució automàtica de Node en propostes de canvis al mòdul.
- Execució local: node --test tests/whatsapp-pilot.test.js.

**No inclou:** connexió amb Meta, recepció webhook, autenticació d'usuaris, reconeixement automàtic de grup, fitxes persistents, IA d'extracció del fil, tractament real d'àudios/imatges, subscripcions Premium, actualització real de Calendar. Això requereix les fases següents.

## 6. Pilots i criteris d'acceptació

Validació local de 11 comprovacions de lògica en un executor JavaScript aïllat amb substitut de la funció de hash criptogràfic. La comprovació nativa amb Node queda delegada a GitHub Actions; no confondre les dues.
1. 8 missatges sintètics d'un grup amb soroll, confirmacions, import i data, materials, duplicats i una hora corregida.
2. El sistema conserva la data i hora **corregides** quan la font declara explícitament que és una rectificació.
3. No duplica accions, pagaments ni esdeveniments repetits.
4. Una contradicció sense rectificació inequívoca queda pendent de revisió; no es presenta com una certesa.
5. Cap contingut multimèdia no analitzat es tracta com si hagués estat llegit.
6. Cap acció envia missatges o crea/modifica esdeveniments automàticament sense consentiment.

## 7. Seguretat i protecció de dades
- Evitar proves amb dades reals de menors; només ficcions fins a definir base legal, transparència i consentiments.
- Els noms dels remitents es transformen en codis locals, però el cos dels missatges pot contenir dades personals. **Pseudonimitzar els remetents no equival a anonimitzar el contingut.**
- No arxivar exports sencers sense política explícita de retenció, eliminació i control d'accés.
- Delimitar qui pot consultar una fitxa familiar; tenir en compte dades de menors i terceres persones.
- Abans d'activar serveis externs: verificar política de tractament, webhooks, signatura, logs sense text personal, idempotència i límits per usuari.
- Cap credencial en codi ni al navegador.

## 8. Estat i properes fases
**Fase A — nucli local completat:** contracte de fitxa viva, proves de reconciliació i consulta de camps amb fonts. Pendent la validació nativa de CI de GitHub i l'extracció automàtica amb IA a partir d'un fil complet.

**Fase B:** verificar i configurar número Meta WhatsApp Business Platform per missatges 1:1; webhook autenticat i recepció segura.

**Fase C:** vincular el missatge rebut a una família/grup, extracció estructurada i persistència aïllada per usuari, consentiment i permisos.

**Fase D:** connectar Gmail i Google Calendar amb aprovació; evitar duplicats i actualitzar esdeveniments.

**Fase E:** flux mòbil mínim d'entrada, pilot real consentit, mètriques d'errors, valor i conversió Free / Premium / Agent.

**Criteri de bloqueig:** no activar producció fins a demostrar privadesa, autenticació, associació fiable a grups i absència de modificacions involuntàries.
