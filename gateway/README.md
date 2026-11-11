# NexLupa — Gateway aïllat per a la recepció de Resend

Únic endpoint: `POST /api/webhook`. Inclou `GET /api/webhook` per consultar únicament l'estat sense dades privades.

## Barreres inicials
- Projecte Vercel separat del frontend principal, root directory `gateway`.
- `FORWARDING_PILOT_ENABLED=false` fins a consentiment de la família i verificació de la connectivitat.
- Doble condició al codi: desplegament **preview** i branca `feature/gmail-resend-forwarding-pilot-20261110`. Sense aquestes condicions, `POST` retorna 503.
- Cap correu es processa si falta un secret de signatura Svix vàlid, connexió Neon de rol restringit o clau de xifrat. Cada petició verifica la signatura del **cos cru** abans de crear l'adaptador de base de dades.
- Identificació de família exclusivament per un àlies aleatori preautoritzat, revalidació atòmica del consentiment i inserció deduplicada i xifrada de **metadades**. Mai es llegeix el cos del correu ni s'executa cap acció automàtica.
- Cap clau API de lectura o enviament de Resend, cap accés a Gmail, Calendar, WhatsApp ni serveis de producció.
- El webhook de proves a Resend es manté `disabled` fins que les proves i consentiments hagin estat completats. El webhook principal de Resend no s'ha de modificar.

## Variables de Vercel (mai a Git)
- `FORWARDING_PILOT_ENABLED=false`
- `FORWARDING_PILOT_WEBHOOK_SECRET` (secret del webhook *de proves*, no el principal)
- `FORWARDING_PILOT_ENCRYPTION_KEY` (clau AES aleatòria de 32 bytes expressats en hex)
- `FORWARDING_PILOT_DATABASE_URL` (només rol `nexlupa_resend_ingest` a branca Neon de validació, TLS `sslmode=verify-full`).

L'absència de qualsevol d'aquests secrets, fins i tot després d'activar la flag, bloqueja la recepció.

## Validacions necessàries
1. GitHub Actions amb proves offline passant.
2. Projecte nou amb la ruta pública accessible però **desactivada**; mai desprotegir el projecte NexLupa principal.
3. Consentiment familiar explícit i àlies verificat a una base de dades aïllada.
4. Prova signed POST amb correus inventats contra el gateway, sense connectar el webhook real.
5. Un cop verificat, apuntar el webhook *desactivat* de Resend a aquest gateway i activar-lo només amb autorització explícita. El receptor principal no es toca.

La seguretat per a serveis públics no depèn del fet que el codi estigui dins d'un repositori; depèn dels controls de signatura, permís, seguretat per defecte, límits i aïllament.
