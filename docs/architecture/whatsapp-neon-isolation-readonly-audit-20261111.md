# NexLupa · Neon: inspecció de només lectura i pla de pilot aïllat

**Data: 11/11/2026. Estat: NO GO per a qualsevol migració o trànsit real.**

## Evidència real recuperada sense modificar Neon

El projecte existent de Neon es diu `nexlupa-resend-pilot` i fa servir PostgreSQL 17. He consultat únicament la llista de projectes, branques i taules de la base de dades; no he executat migracions, cap `INSERT`/`UPDATE`/`DELETE`, ni he llegit files d'usuaris.

- Branca per defecte `pilot`: hi ha, com a mínim, la taula `nexlupa_pilot.resend_inbox_queue`.
- Branca `whatsapp-auth-pilot-validation-20261109`: és una branca **no predeterminada, creada amb dades heretades** (`init_source = parent-data`). Conté taules del sistema `neon_auth`, `nexlupa_pilot.resend_inbox_queue` i `public.nex_whatsapp_inbound` / `public.nex_whatsapp_sender_authorizations`.
- La branca `whatsapp-schema-validation-20261108` és descendent de `pilot`; altres proves de Resend també tenen dependències de la mateixa base.

**Conclusió:** una branca nova creada a partir del projecte actual pot heretar contingut. No es considera un espai buit ni se n'han de copiar usuaris o missatges per fer les proves de consentiment WhatsApp. El fet que una branca sigui «preview» o «validation» no garanteix la seva privacitat.

## Projecte nou creat i verificat (11/11/2026)

**Autorització explícita de l'usuari:** crear el sandbox sempre que no impliqui cost addicional. El compte continua a Neon **Free**; la documentació oficial confirma que permet fins a 100 projectes sense facturar excessos.

- Projecte nou: `nexlupa-whatsapp-consent-sandbox-20261111` (`flat-night-91815247`), **aïllat per ID de projecte** de `nexlupa-resend-pilot` (`silent-sound-81074119`).
- PostgreSQL 17, regió `aws-eu-central-1`. Branca arrel predeterminada `sandbox-empty` (`br-royal-breeze-b9i4vo0n`), estat `ready`. Aquesta branca és **principal dins del nou sandbox**, no una branca del projecte existent.
- Inventari de taules i vistes fora d'esquemes de sistema: **llista buida `[]`** en el moment de la comprovació.
- Neon informa `init_source: parent-data` tot i no indicar `parent_id` per a aquesta branca arrel. **No interpretar aquesta etiqueta com a prova que s'han copiat dades del projecte antic**; el projecte té un ID propi i cap taula d'aplicació.
- No s'ha passat cap cadena de connexió, cap secret, cap SQL de migració, cap dada real, ni s'ha fet cap enviament a Meta o Vercel.
- El nou projecte és buit de taules d'aplicació, però **no està preparat per al pilot**: falta crear una branca de treball, desplegar un esquema revisat per Neon i provar permisos, autèntica segregació d'identitats i proves fictícies.

## Pla restant per preparar el nou sandbox

1. **Completat:** projecte Neon nou i buit amb el nom anterior creat en un compte Free; confirmat que no hi ha taules d'aplicació.
2. Confirmar que el projecte inicial no conté cap dada empresarial, compte d'usuari real, sessió, correu, número ni registre de Resend. Si es crea una branca descendent d'aquesta base buida, verificar també l'origen i la còpia abans de considerar-la neta.
3. Només després de l'anàlisi del punt anterior, crear una branca no predeterminada `whatsapp-consent-preview-YYYYMMDD`, amb dades completament fictícies i credencials dedicades. La branca ha de ser independent dels recursos de producció de NexLupa.
4. Revisar i adaptar la migració canònica TTP240 i les tres funcions signades a un esquema específic de preview. Els SQL `*_ci.sql` actuals no són una migració per a Neon: creen rols ficticis i dependències de PostgreSQL efímer.
5. Comprovar RLS i rols mínims, locks de membres, separació entre emissors de prova/rebut/activació, retenció i rotació de claus. Fer rollback en una branca disposable abans d'executar res real.
6. Fer un E2E amb dos usuaris *ficticis* i esdeveniments Meta de prova, sense cap grup familiar real. Validar l'entrada duradora, revocació, permisos creuats i eliminació de totes les dades de prova.
7. Quan l'E2E i la revisió de privacitat siguin satisfactoris, sol·licitar aprovació explícita abans de qualsevol accés real o llançament.

## Control incorporat a GitHub

- `lib/whatsapp/isolated-neon-target-audit.js`: auditoria **offline de metadades**. Rebutja projectes que no siguin un sandbox dedicat, branques predeterminades, taules existents de l'aplicació i còpies de dades sense constatació independent que el pare és buit.
- `tests/whatsapp-isolated-neon-target-audit.test.js`: comprova una topologia semblant a la del Neon actual; rebutja que una branca heretada es consideri segura per defecte. Les claus i URL de connexió no s'inclouen mai a la sortida de l'auditoria.
- **GitHub Actions [#42936143056](https://github.com/DavidParet/Primer-projecte/actions/runs/42936143056) i [#42936143234](https://github.com/DavidParet/Primer-projecte/actions/runs/42936143234): SUCCESS.**

**Limitació explícita:** l'auditoria de metadades retorna `migrationApproved: false` i `safeToExecuteSQL: false` **sempre**. L'absència de taules no prova, per si sola, la privacitat ni la separació de credencials; cal una verificació independent del projecte, del seu origen, de les branques i dels permisos reals.

**Proteccions actives:** PR #15 continua en esborrany; només s'ha creat el nou projecte Neon buit i la seva branca arrel. No s'ha creat cap branca addicional, executat SQL ni fet merge o desplegament a Vercel o Meta. El projecte existent no s'ha modificat.
