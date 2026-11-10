# NEXLUPA · WhatsApp fase 4: consentiment i revocació

Estat: **prototip en branca de GitHub; sense endpoint ni verificació telefònica activa**.

## Fet
- Nou mòdul `lib/whatsapp/consent-policy.js`: només un servei autenticat extern pot resoldre la família i acreditar el control d'un número mitjançant una prova d'un sol ús.
- Alta: cap `familyId` del client és fiable; autorització vinculada al compte de WhatsApp Business, número receptor, hash HMAC de l'emissor i `incoming_text`.
- Baixa: instrucció SQL restringida explícitament per família autenticada i pseudònim del remitent. Retorna `revoked` o `not_found`; no inventa una baixa.
- El temps d'expiració de la prova telefònica **no** és la caducitat del consentiment.
- Proves unitàries sintètiques: alta, intents entre famílies, caducitat, reiteració, baixa i invalidació.
- Neon: branca separada `whatsapp-schema-validation-20261108`, base `nexlupa_pilot`: DDL aplicat i provada la sentència real `stored`, `duplicate`, `unlinked` amb dades fictícies; 1 registre conservat per ID.
- La branca principal `pilot` de Neon i la web pública no s'han modificat.

## Bloquejos de seguretat abans de producció
1. Implementar un proveïdor d'identitat i servei de comprovació telefònica real, amb reptes d'un sol ús, controls d'abús, límits d'intents i expiració. El prototip actual només defineix interfícies i requereix dependències fiables.
2. Recollir consentiment explícit i informatiu (versió i abast) en una UI i registrar-ne una evidència auditable. Una prova de control del número **no equival** a consentiment.
3. Resoldre una debilitat de la PR #7: els remitents sense consentiment i els lots de dades no tenen encara una política definitiva de resposta HTTP ni una cua d'errors.
4. Implementar revocació efectiva en temps real, retenció i supressió de dades que ja estiguin guardades, control per família a les lectures, seguretat de xifrat i registre d'auditoria sense contingut.
5. Fer proves de concurrència PostgreSQL i scripts d'integració amb el webhook signat; encara no s'ha enllaçat Meta.
6. Provar l'alta/baixa en un entorn de prova Vercel independent, havent reparat la configuració de rutes de `main` per PR #3.
7. Definir protecció de dades de menors/tercers i ús de missatges reenviats. No suposar accés als grups originals.

**NO FUSIONAR, NO DESPLEGAR, NO ENVIAR MISSATGES.** Aquesta PR se superposa a #7 (que ja se superposa a #6).
## 2026-11-10 · Correcció de cursa entre alta de missatge i revocació
- `lib/whatsapp/durable-inbox.js` afegeix `FOR SHARE` a la lectura de l'autorització abans de l'INSERT. La revocació fa `FOR UPDATE`, marca la baixa i purga en una segona sentència dins una transacció `READ COMMITTED`.
- Una comprovació no destructiva `EXPLAIN` a Neon, a la branca aïllada `whatsapp-auth-pilot-validation-20261109`, confirma el node PostgreSQL `LockRows` i l'ús de l'índex `nex_whatsapp_one_active_family` per a la consulta amb `FOR SHARE`.
- Prova unitària afegida per impedir que desaparegui el bloqueig SQL. El workflow de consentiment ara inclou `whatsapp-tenant-revocation.test.js` i s'executa també en pushes de la branca de desenvolupament.
- **Pendent:** una prova de concurrència real amb dues connexions PostgreSQL i missatges ficticis, validació completa de l'INSERT amb el runtime desplegat, permisos mínims i auditoria de l'aïllament. `EXPLAIN` no prova per si sol que no hi hagi curses ni valida el circuit extrem a extrem.
- **No activar Meta, no fusionar a `main`, no desplegar, no utilitzar dades personals reals.**
