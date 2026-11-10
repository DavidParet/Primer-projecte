# NexLupa — WhatsApp fase 3: persistència segura (prototip)
Data: 2026-11-08 · Estat: **aïllat en PR draft**. Ni Meta, ni Vercel, ni Neon productius estan connectats.

## Objectiu
Preparar emmagatzematge de missatges de text entrants que només accepti remitents amb consentiment familiar actiu i verificable, sense conservar el número cru ni el text en clar. No es pot inferir el grup original d'un missatge reenviat.

## Implementat al codi
- `db/migrations/20261108_whatsapp_durable_inbox.sql`: taules per autorització per família, contingut xifrat, indexació i clau única per missatge Meta.
- `lib/whatsapp/durable-inbox.js`: adaptador PostgreSQL desacoblat de la ruta HTTP. En una sentència SQL atòmica cerca l'autorització activa i insereix només si es compleixen les condicions.
- Xifrat AES-256-GCM (nonce aleatori i AAD lligat a compte/número/missatge) i pseudònim HMAC-SHA256 del número del remitent, amb claus independents.
- El codi ignora els camps `familyId` i `groupId` dels missatges entrants. Família resolta exclusivament per consentiment a PostgreSQL; grup original desconegut.
- La multimèdia queda pendent i no es guarda. Els lots malformats provoquen error.
- Camp `expires_at` de set dies i funció de purga, **encara no programada**.

## Condicions per a un pilot real
1. Validar la signatura HMAC de Meta sobre els bytes RAW al webhook de la PR #6; només després passar el payload a l'adaptador.
2. Alta/baixa segura amb login familiar, prova de control del número, consentiment informat, versió, revocació i auditoria. No implementat.
3. Variables de servidor `WHATSAPP_SENDER_HMAC_KEY` i `WHATSAPP_CONTENT_ENCRYPTION_KEY` gestionades com a secrets independents (32 bytes en base64). No hi ha claus al codi ni a Vercel.
4. Proves SQL reals contra una base de **desenvolupament segregada** de Neon; la CI actual usa `db.query` simulat i no garanteix l'execució real de PostgreSQL.
5. Permisos de mínims privilegis, segregació per família a les lectures, política RGPD per dades de menors i tercers, dret d'eliminació, i tasca real de purga monitorada.
6. Decidir el tractament de remitents no enllaçats, multimèdia, errors parcials de lot i reintents abans de retornar HTTP 200.
7. Proves d'extrem a extrem amb dades sintètiques en preview protegit de Vercel.

## No implementat
- Cap migració aplicada; cap base de dades Neon creada o modificada.
- Cap endpoint públic amb persistència; `api/whatsapp-webhook.js` continua fail-closed (POST signat -> 503).
- Cap número Meta vinculat, cap missatge real, cap alta de consentiment, cap sincronització Calendar.
- Cap lectura familiar, desxifrat ni worker de purga operatiu.
- Cap fusió, canvi de configuració d'entorn o modificació de producció.

## Validació
`node --test tests/whatsapp-durable-inbox.test.js tests/whatsapp-webhook.test.js tests/whatsapp-delivery-normalizer.test.js`

Aquesta PR es basa en la branca de la PR #6 (receptor signat). PR #5 (importació de xats), #4 (agent familiar) i #3 (reparació Vercel) són independents.
