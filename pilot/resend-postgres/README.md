# NEXLUPA — cua PostgreSQL privada (NO desplegada)
## Estat: codi i proves aprovades, infraestructura NO activada
Data: 8 de novembre de 2026. Aquest directori és un pilot independent.
La web `nexlupa.app` i `main` no es modifiquen.

### Fitxers preparats
- `001_queue.sql` — migració d'una taula privada, índexs per a treballs llestos i leases, clau primària `queue_id` per deduplicar.
- `../../lib/premium-resend-postgres-store.js` — adaptador `db.query(sql, params)` per a PostgreSQL: insert transaccional, claim amb `SKIP LOCKED`, lease token aleatori, reintents, expiració de treballs abandonats i eliminació segura per antiguitat d'estats finals.
- `../../lib/premium-resend-verified-intake.js` — accepta un webhook després de validar la signatura Svix i intenta desar les metadades xifrades.
- `../../lib/premium-resend-secure-queue.js` — AES-256-GCM, ID HMAC per deduplicació i sobre mínim sense remitent, assumpte o cos.

### Proveïdor recomanat per al pilot
PostgreSQL gestionat, dins d'un projecte aïllat i sense dades reals.
Neon està disponible a Vercel Marketplace (https://vercel.com/marketplace/neon).
Els plans gratuïts tenen límits; abans d'acceptar la connexió,
comprovar facturació i quota al compte. No donar per fet un compte ja creat.

### Abans d'encendre cap receptor automàtic
1. Connectar una base de dades PostgreSQL de proves **només** a `nexlupa-resend-pilot`. L'acció requereix autorització explícita al proveïdor.
2. Aplicar `001_queue.sql` amb credencials d'instal·lació, crear després un rol d'aplicació amb permisos mínims i validar l'aïllament.
3. Secret xifrat independent de 32 bytes per a la cua; rotació i gestió de claus. Secrets només al gestor d'entorn privat; cap clau a GitHub, xat o logs.
4. Instal·lar un client `pg` o compatible a l'executable **aïllat**. El codi d'aquest directori no instal·la ni inicialitza la connexió.
5. Fer proves **amb una instància de PostgreSQL real** per validar el SQL, dues peticions concurrents, un error DB, expiració de lease i reintents. Les proves actuals simulen `db.query`.
6. Preparar ruta POST que comprovi la signatura **abans** de desar i que retorni 2xx **només després de commit**. Si la DB falla, no confirmar el webhook.
7. Crear worker separat, limitat a les metadades; autenticar independentment el remitent i la família i disposar de consentiment abans de llegir contingut.
8. Determinar política de conservació abans d'activar `purgeTerminal`; no esborrar mai estat `received`, `processing` o `retry` automàticament.
9. Comprovar idempotència per família i per font, retenció, fitxes, revisió humana i no escriptura a Calendar sense autorització.
10. Fer una prova real de correu **completament inventat**; després decidir una activació limitada.

### Restriccions explícites
- No tocar les adreces de Zoho ni l'MX del domini arrel.
- No executar SQL a la base de dades d'una altra aplicació.
- No desplegar una cua sobre memòria temporal de funcions serverless.
- No habilitar processament real en una branca de proves per defecte.
- **Les proves CI de GitHub no substitueixen proves d'integració amb un PostgreSQL real.**
