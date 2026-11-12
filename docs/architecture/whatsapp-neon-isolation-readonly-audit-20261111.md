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

## Actualització executada el 11/11/2026: branca preview sense compute

- Branca creada **dins del projecte sandbox** `flat-night-91815247`: `whatsapp-consent-preview-20261111`, ID `br-aged-rice-b99jb33r`.
- Pare explícit: `br-royal-breeze-b9i4vo0n` (`sandbox-empty`), inventari del pare consultat de nou i buit `[]` just abans de crear-la. Cap connexió amb `nexlupa-resend-pilot`.
- Estat retornat per Neon: `ready`, `primary=false`, `default=false`, `init_source=parent-data`, amb `no_compute=true`; sense escriptures de dades d'aplicació.
- **L'inventari de taules de la nova branca NO està verificat**: `get_database_tables` ha retornat `endpoint not found` perquè no hi ha endpoint de compute. No inferir una attestació independent a partir de la còpia del pare.
- No s'han creat rols, executat SQL, aplicat migracions, configurat claus ni desplegat cap webhook. Per a la prova real caldrà configurar un endpoint de preview limitat i revisar permisos/cost, amb autorització expressa per a la migració.
- L'auditoria offline `isolated-neon-target-audit.js` ara exigeix `branch.project_id === project.id` i `tableInventoryComplete === true`; les comprovacions no concedeixen permís de migració.

**Estat: encara NO GO per SQL de migració o trànsit Meta.**

## Pla restant per preparar el nou sandbox

1. **Completat:** projecte Neon nou i buit amb el nom anterior creat en un compte Free; confirmat que no hi ha taules d'aplicació.
2. **Parcial:** inventari del pare confirmat sense taules d'aplicació; la branca preview s'ha creat sense compute. Pendent inventari independent de la branca i revisió de credencials/identitat.
3. **Completat només com a infraestructura:** `whatsapp-consent-preview-20261111` creada al sandbox sense compute. Pendent configurar compute i credencials de preview amb revisió de cost i permisos; cap dada fictícia inserida encara.
4. Revisar i adaptar la migració canònica TTP240 i les tres funcions signades a un esquema específic de preview. Els SQL `*_ci.sql` actuals no són una migració per a Neon: creen rols ficticis i dependències de PostgreSQL efímer.
5. Comprovar RLS i rols mínims, locks de membres, separació entre emissors de prova/rebut/activació, retenció i rotació de claus. Fer rollback en una branca disposable abans d'executar res real.
6. Fer un E2E amb dos usuaris *ficticis* i esdeveniments Meta de prova, sense cap grup familiar real. Validar l'entrada duradora, revocació, permisos creuats i eliminació de totes les dades de prova.
7. Quan l'E2E i la revisió de privacitat siguin satisfactoris, sol·licitar aprovació explícita abans de qualsevol accés real o llançament.

## Control incorporat a GitHub

- `lib/whatsapp/isolated-neon-target-audit.js`: auditoria **offline de metadades**. Rebutja projectes que no siguin un sandbox dedicat, branques predeterminades, taules existents de l'aplicació i còpies de dades sense constatació independent que el pare és buit.
- `tests/whatsapp-isolated-neon-target-audit.test.js`: comprova una topologia semblant a la del Neon actual; rebutja que una branca heretada es consideri segura per defecte. Les claus i URL de connexió no s'inclouen mai a la sortida de l'auditoria.
- **GitHub Actions [#42936143056](https://github.com/DavidParet/Primer-projecte/actions/runs/42936143056) i [#42936143234](https://github.com/DavidParet/Primer-projecte/actions/runs/42936143234): SUCCESS.**

**Limitació explícita:** l'auditoria de metadades retorna `migrationApproved: false` i `safeToExecuteSQL: false` **sempre**. L'absència de taules no prova, per si sola, la privacitat ni la separació de credencials; cal una verificació independent del projecte, del seu origen, de les branques i dels permisos reals.

**Proteccions actives:** PR #15 continua en esborrany; hi ha un projecte Neon sandbox i una branca preview *sense compute*, sense SQL aplicat, sense merge ni desplegaments a Vercel o Meta. El projecte existent no s'ha modificat.
