# NEXLUPA — cua de correus xifrada, pilot restringit
**8 novembre 2026. Disseny i prototip; NO actiu en producció.**

## Resultat verificat
- `entrada.nexlupa.app`: domini Resend **verified**, MX i DKIM **verified**.
- Correu fictici enviat a `pilot@entrada.nexlupa.app`: rebut i cos recuperat amb l'API Resend.
- Webhook Resend `email.received`: **success**, un HTTP **204** real a l'endpoint Vercel aïllat. AQUEST ENDPOINT només confirma la notificació: **no implementa la cua**.
- Codi de desenvolupament, no desplegat: `lib/premium-resend-secure-queue.js` i `lib/premium-resend-verified-intake.js`. Verifiquen Svix sobre text cru, validen destinatari pilot, **xifren només `email_id` i destinatari**, calculen un ID HMAC per a deduplicació i exigeixen una operació `insertIfAbsent` realment durable.
- Les proves utilitzen base de dades **fictícia en memòria** i claus de prova aleatòries. **No hi ha persistència a Vercel ni credencial de lectura Resend al servidor.** Tot error en emmagatzemar s'ha de traduir en resposta HTTP no satisfactòria; no donar mai 204 abans de persistir.

## Decisions per a la següent implementació
1. Provisionar un **PostgreSQL privat** o emmagatzematge amb equivalència transaccional, independent del web corporatiu; valorar el pla i el cost abans d'activar-lo.
2. Crear índex únic sobre l'ID HMAC de cada correu i implementació `INSERT ... ON CONFLICT DO NOTHING` dins d'una transacció.
3. Guardar `queue_id` i **sobre xifrat AES-256-GCM** a la base, i metadades mínimes de processament. Ni cos ni assumpte ni remitents als logs.
4. Guardar les claus de xifratge/HMAC i Resend API en un **gestor de secrets**, mai en repositoris o documentació. Definir estratègia de rotació de claus abans de llançament.
5. Separar procés receptor i treballador de la cua, amb lloguer/lease de treballs i reintents limitats. En cas de base de dades caiguda: error 503, mai confirmar recepció com a desada.
6. El treballador no llegirà el contingut per a IA fins que existeixin **consentiment familiar**, registre de família, destinatari únic verificat i **autenticació independent del remitent**. El camp `From` per si sol no acredita identitat.
7. Provar adjunts per separat, amb limitació de mida i inspecció; avui es rebutgen per defecte.
8. Conservar els missatges mínim imprescindible, definir retenció/esborrat i traçabilitat sense dades personals. Cap escriptura automàtica al Calendar abans de revisió i consentiment.

## SQL orientatiu — pendent de desplegar
```sql
CREATE TABLE resend_inbox_queue (
  queue_id CHAR(64) PRIMARY KEY,
  encrypted_envelope TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received','processing','done','needs_review','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Només confirmar HTTP 2xx si l'INSERT s'ha confirmat transaccionalment.
-- Duplicats: ON CONFLICT(queue_id) DO NOTHING.
-- Afegir TTL/purgat segons la política de retenció aprovada.
```

## Separació d'entorns
- `main` de `DavidParet/Primer-projecte`, web `nexlupa.app`, Zoho, Namecheap, Calendar i dades de famílies: **intactes**.
- Branca `product/whatsapp-premium-20261107`: codi experimental, proves sintètiques.
- Projecte Vercel `nexlupa-resend-pilot`: només webhook de transport, sense cua.
- **No canviar el webhook en producció a una cua en memòria**: Vercel serverless no garanteix memòria persistent ni idempotència.

## Què manca
La cua és **una interfície segura provada**, no un servei actiu. El següent lliurable desplegable requereix **base de dades privada transaccional, secrets segurs, worker i proves reals end-to-end amb correus inventats**; només després pot considerar-se l'exposició voluntària a dades reals.
