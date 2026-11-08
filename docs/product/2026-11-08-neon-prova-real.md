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
