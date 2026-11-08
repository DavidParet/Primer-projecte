# NEXLUPA — primera integració amb PostgreSQL real (Neon)
**Data:** 8 novembre 2026. **Entorn aïllat. Sense correus reals de famílies.**

## Fets executats i comprovats
- Neon OAuth connectat a ChatGPT. Organització en pla **free**.
- Projecte Neon exclusiu `nexlupa-resend-pilot`, ID `silent-sound-81074119`, regió **aws-eu-central-1**.
- Branca pilot `br-cold-pine-b9tm9zun`, base `nexlupa_pilot` (PostgreSQL 17).
- Migració real aplicada transaccionalment des del fitxer `pilot/resend-postgres/001_queue.sql`. Esquema `nexlupa_pilot`, taula `resend_inbox_queue` i tres índexs.
- Prova SQL real executada dins una **taula temporal**, amb inserció idempotent, bloqueig de fila amb `FOR UPDATE SKIP LOCKED`, lease UUID i finalització. PostgreSQL no ha comunicat errors.
- Lectura posterior confirmada: `persistent_rows = 0`, `index_count = 3`, base `nexlupa_pilot`. **Cap missatge real desat**.
- Nou codi de receptor aïllat `pilot/resend-durable-webhook/handler.js`: sobre signat, validació de destinatari, xifratge i confirmació 204 només després de `insertIfAbsent`; error de base de dades -> 503; 204 sense cos.
- Codi de receptor encara NO desplegat: totes les proves d'aquest nou component usen una base fictícia en memòria. **CI: 21/21 superades**: https://github.com/DavidParet/Primer-projecte/actions/runs/42510204473

## Què NO està fet
- Vercel `nexlupa-resend-pilot` encara **no està connectat** a la base Neon. No hi ha `DATABASE_URL`, rol de mínim privilegi o clau de xifratge en l'entorn del projecte pilot.
- El webhook públic anterior continua limitat a validació de signatura/HTTP 204, **sense cua ni procés d'interpretació**.
- No s'ha fet una prova de transacció amb 2 clients PostgreSQL independents ni una prova end-to-end d'enviament de correu cap a una cua persistent real.
- No hi ha autenticació independent de remitents, registre i consentiment de famílies, worker automatitzat, fitxa persistent per família, gestió de retenció aprovada o operacions de Calendar.
- No hi ha canvis a `main`, a la web pública, a Zoho ni als dominis.

## Proper pas tècnic
1. Crear rol PostgreSQL de servei amb permisos estrictament delimitats i comprovar connexió (aplicació pooled, migracions directes).
2. Instal·lar client PostgreSQL dins el **projecte de desplegament aïllat**, sense alterar les dependències de producció.
3. Guardar `DATABASE_URL`, `RESEND_WEBHOOK_SECRET` i una clau AES-256-GCM pròpia al secret manager del pilot. No escriure mai cap secret a GitHub ni al xat.
4. Desplegar ruta que utilitzi el receptor amb cua durable. Inicialment **sense processar correus ni Calendar**.
5. Validar amb un correu completament inventat que l'HTTP 204 només es produeix després del commit, que els reintents no dupliquen i que les dades personals no apareixen en registres.


## Progrés posterior — connexió parcial Vercel → Neon (8 novembre, vespre)
- Creat a Neon el rol `nexlupa_resend_ingest` amb **read_write limitat a la base `nexlupa_pilot` i l'esquema `nexlupa_pilot`**, sense privilegis CREATE a la base. Verificat amb una consulta real executada amb aquest rol: `schema_usage=true`, `queue_rw=true`, `can_create_database_objects=false`.
- Configurats com a secrets xifrats al projecte Vercel **separat** `nexlupa-resend-pilot`: `DATABASE_URL`, `RESEND_QUEUE_ENCRYPTION_KEY`. Les mateixes dues variables s'han afegit al seu entorn de **preview**, juntament amb `RESEND_PILOT_RECIPIENT=pilot@entrada.nexlupa.app`. **Cap valor secret s'inclou a GitHub**.
- `RESEND_WEBHOOK_SECRET` continua configurat **només a production** del projecte pilot; no s'ha afegit a preview. Per tant, el receptor nou a preview **rebutja** missatges fins que s'habilitin deliberadament proves controlades. El webhook Resend vigent de production encara apunta al receptor anterior que només acusa recepció, sense desar el cos.
- Codi nou: `pilot/resend-durable-webhook/api/webhook.js` i `api/status.js`, a la branca de proves. Receptor amb configuració obligatòria, PostgreSQL de mínim privilegi i confirmació 204 només si la inserció transaccional té èxit. El `status` només comprova `SELECT 1`, no llegeix dades familiars.
- Desplegament Vercel **PREVIEW** `dpl_7gPDYNjLxxkuxJ7hzYHW7p1qs5A8`, `READY`, URL tècnica `https://nexlupa-resend-pilot-lq3n6540z-davidparets-projects.vercel.app`. `READY` confirma el build, **NO** la connexió HTTP en execució: la comprovació externa de `/api/status` no ha estat accessible a l'eina web, i per això **no es pot afirmar que la connexió Vercel→Neon s'hagi comprovat de punta a punta**.
- Prova de seguretat de la ruta amb secrets absents a GitHub CI: `tests/run-premium-resend-vercel-durable-route.js`, **22/22 suites PASS** https://github.com/DavidParet/Primer-projecte/actions/runs/42511374704.
- **Encara pendent:** prova HTTP del preview a `/api/status`, proves amb el receptor + PostgreSQL real i signatura Resend en un entorn segur, autenticació real de remitents i consentiment familiar. `main`, `nexlupa.app`, Zoho, DNS i Google Calendar no modificats.


## Progrés addicional — 8 novembre 2026, verificació de rol i regió europea
- Nova comprovació read-only `lib/premium-resend-db-health.js`: exigeix explícitament base `nexlupa_pilot`, rol `nexlupa_resend_ingest`, esquema correcte, taula de cua i cadascun dels quatre permisos (`SELECT`, `INSERT`, `UPDATE`, `DELETE`); exigeix absència del privilegi `CREATE`. Resposta pública únicament booleana.
- **Prova amb Neon real:** la consulta equivalent, executada amb el rol limitat, ha retornat `ready=true`. Això valida els permisos efectius a la base de dades, no la connexió HTTP del servidor.
- Nou test `tests/run-premium-resend-db-health.js` dins la bateria: **23/23 PASS**, https://github.com/DavidParet/Primer-projecte/actions/runs/42511995828.
- Ruta `pilot/resend-durable-webhook/api/status.js` actualitzada per fer la comprovació de permisos i rol, sense consultar continguts de missatges. **Tant el receptor com la ruta de salut només estan en desplegaments de preview**, no en el webhook Resend de producció del pilot.
- Configuració `pilot/resend-durable-webhook/vercel.json` amb regió Vercel `fra1`; configurat també el projecte aïllat Vercel amb `functionDefaultRegions=['fra1']`. Desplegament PREVIEW més recent `dpl_E3cYx2X3MURPph8s7ifzfw3pJxcY` en estat **READY**, `regions=['fra1']`, URL `https://nexlupa-resend-pilot-qa5pxltf7-davidparets-projects.vercel.app`.
- **LIMITACIÓ IMPORTANT:** la petició externa a `/api/status` continua inaccessible des de les eines web disponibles; no hi ha proves HTTP de connexió Vercel→Neon, i la manca de registres d'invocació no demostra cap èxit. No desactivar la protecció del preview ni redirigir Resend només per provar-lo.
- Verificació de seguretat: l'únic webhook real de Resend continua habilitat amb destinació `https://nexlupa-resend-pilot-davidparets-projects.vercel.app/api/webhook` (receptor antic, només transport). La cua permanent de Neon conté **0 files**. Cap email real de famílies, Calendar ni web pública modificats.
- Per a la propera fita: prova de la ruta de salut via client Vercel autenticat, després prova d'inserció sintètica transaccional i, només quan estigui validada, plantejar el canvi controlat del webhook real. No connectar encara processament automàtic ni IA.
