# NexLupa · WhatsApp — portes d'entrada al pilot preview

**11/11/2026 · NO GO · PR #15 DRAFT.** Aquest checklist és preparatori; no autoritza desplegaments, migracions a Neon, activació de Meta ni accés a converses reals. Cap dada de producció ha d'entrar a la prova.

## Evidència CI confirmada

| Control | Estat | Evidència |
|---|---|---|
| Signatura RAW de Meta, codi, destí oficial, replay | Aprovat només amb Meta simulat | [#42930991895](https://github.com/DavidParet/Primer-projecte/actions/runs/42930991895) |
| Consentiment explícit, versió, prova telefònica única | Aprovat només amb web/usuari simulat | [#42931790194](https://github.com/DavidParet/Primer-projecte/actions/runs/42931790194) |
| Alta atòmica, família canònica, concurrència | Aprovat en PostgreSQL temporal | [#42932708979](https://github.com/DavidParet/Primer-projecte/actions/runs/42932708979) |
| Rols sense bypass RLS, cap execució SQL creuada | Aprovat en PostgreSQL temporal | [#42933402350](https://github.com/DavidParet/Primer-projecte/actions/runs/42933402350) |
| Producció no exposa pantalla pilot, codi ni migracions | Aprovat amb build sintètic | [#42934145412](https://github.com/DavidParet/Primer-projecte/actions/runs/42934145412) |
| Regressions de dues famílies i PostgreSQL | Aprovat en CI | [#42934145477](https://github.com/DavidParet/Primer-projecte/actions/runs/42934145477) |
| Inventari preflight: mode live denegat per defecte, noms sense valors de secrets | Aprovat en CI | [#42934579747](https://github.com/DavidParet/Primer-projecte/actions/runs/42934579747) |
| Regressió completa durable inbox i dues famílies després de reforçar preflight | Aprovat en CI | [#42934579673](https://github.com/DavidParet/Primer-projecte/actions/runs/42934579673) |

**Límit:** les respostes de Neon Auth i Meta en aquestes proves són simulades. Els tests no demostren una connexió amb els seus serveis reals.

## Fases pendents d'execució

### 1. Entorn aïllat Neon (NO GO)

**Inspecció real de només lectura, 11/11/2026:** el projecte `nexlupa-resend-pilot` conté una branca principal amb la cua de Resend i branques descendents amb taules `neon_auth` i de WhatsApp. Les branques existents **no són un entorn inicial buit**. **Projecte sandbox nou creat i verificat:** `nexlupa-whatsapp-consent-sandbox-20261111` (`flat-night-91815247`), PostgreSQL 17, amb la branca arrel `sandbox-empty` (`ready`) i cap taula d'aplicació. L'usuari n'ha autoritzat la creació condicionada a no incrementar el cost; s'ha confirmat Neon Free. El projecte antic ha quedat intacte. Vegeu la [inspecció i estat d'aïllament](./whatsapp-neon-isolation-readonly-audit-20261111.md). **Actualització 12/11/2026:** la branca preview `whatsapp-consent-preview-20261111` (`br-aged-rice-b99jb33r`) ja està creada dins el projecte sandbox sense endpoint compute. El pare `sandbox-empty` continuava sense taules d'aplicació quan es va consultar. L'inventari independent de la branca preview no s'ha pogut completar perquè no hi ha endpoint. No s'ha executat cap migració ni SQL de dades; la base Neon principal segueix intacta.

- Confirmar una branca de prova sense còpia de dades familiars, missatges, correus, telèfons ni identificadors reals.
- Preparar scripts per a preview **diferents** dels `*_ci.sql`; aquells fitxers són exclusius d'un PostgreSQL efímer i contenen rols `nex_ci_*` no aptes per aplicar a Neon real.
- Revisar migració d'anada i retirada, rol runtime restringit, RLS, `SECURITY DEFINER`, drets sobre seqüències, permisos que poden heretar rols i rotació de claus.
- Definir proves de rollback i destrucció del conjunt de dades fictícies. No executar sense revisió i aprovació específica.

### Primera prova integrada real sobre PostgreSQL temporal (12/11/2026)

- `tests/whatsapp-postgres-signed-inbox-e2e.test.cjs` posa a prova tot el recorregut: HMAC sobre el webhook Meta fictici → comprovació de consentiment de remitent → SQL a PostgreSQL 17 → text xifrat AES-256-GCM → `SET ROLE nex_ci_inbox_reader_runtime` → permís de lectura signat d'un sol ús → desxifrat JavaScript.
- Comprova també firma Meta falsa (403 sense persistència), reenviament idempotent, remitent sense permís (503, cap escrit), rol SQL sense `SELECT` directe, reenviament de nonce i temptativa de canvi de família rebutjats; el text real/fictici no es guarda en clar.
- **Límit verificat:** el test d'ingesta s'executa amb l'administrador de la BD efímera i el vincle IdP és una simulació; no demostra privilegis mínims d'ingesta ni autenticació real de Neon Auth/Meta. No s'ha executat cap test a Neon ni desplegat a Meta.

### Recepció xifrada amb rol SQL restringit (CI ONLY, 12/11/2026)

- `db/migrations/20261112_whatsapp_signed_inbound_ingest_ci.sql` crea dos rols sense login, una funció SECURITY DEFINER amb SQL només en PostgreSQL 17 efímer i claus separades per a la signatura d'ingesta. El rol `nex_ci_inbound_ingest_runtime` només pot fer EXECUTE de la funció signada; no pot llegir consentiments, missatges o claus, ni inserir directament.
- `lib/whatsapp/signed-inbound-ingest-adapter.js` converteix l'INSERT del mòdul de recepció en una autorització HMAC d'un sol ús, de 30 segons, sobre compte/telefon oficial, digest HMAC del remitent, identificador Meta, timestamp, nonce AES-GCM, tag i hash del xifrat. Només es pot invocar després de verificar independentment la signatura Meta sobre els bytes RAW.
- La funció comprova la signatura, la clau activa, el nonce no reutilitzat i bloqueja el consentiment del remitent durant l'INSERT. Rebutja permisos caducats/revocats, remitents desconeguts, col·lisions entre famílies i persistència de contingut no xifrat. Una altra funció i rol restringits fan la lectura familiar posterior.
- La prova `tests/whatsapp-postgres-signed-inbox-e2e.test.cjs` usa explícitament `SET ROLE nex_ci_inbound_ingest_runtime` per rebre i `SET ROLE nex_ci_inbox_reader_runtime` per consultar, amb el compte administrador reservat a preparar dades sintètiques. Verifica signatures Meta simulades, registres AES-GCM reals, duplicitats, autorització familiar i denegació de SQL directe.
- **Riscos pendents de pilot real:** aquest esquema existeix únicament en CI, no s'ha instal·lat a Neon, no ha passat la comprovació amb una credencial de login real de mínim privilegi, ni la validació de Meta Cloud API; falta revisió de l'amenaça de compromís del signer, rotació/custòdia de claus, neteja dels nonces caducats i autorització del pilot. El rol propietari de la funció té `UPDATE(consent_at)` exclusivament perquè PostgreSQL permeti `FOR SHARE`; aquest privilegi ha de ser auditat.
- **No GO:** no desplegar el servidor públic de webhook ni connectar pares, infants o grups reals fins que es validin permisos, consentiments, privacitat i retenció.

### Lectura dels avisos del pilot (STAGED ONLY, 12/11/2026)

- Nou mòdul intern `lib/whatsapp/pilot-family-inbox-reader.js`: valida la sessió de pilot, el rol familiar, la paginació i les files retornades; desxifra localment amb AES-256-GCM després de tornar a comprovar autorització i sessió. No retorna remitent, número o grup original.
- **RPC SQL creat exclusivament per a CI:** `db/migrations/20261112_whatsapp_family_inbox_reader_ci.sql` implementa `public.nex_ci_read_family_whatsapp_inbox` només en un PostgreSQL temporal. **NO s'ha aplicat a Neon**, on la funció continua absent. No s'ha activat cap API de lectura pública.
- El RPC de CI verifica el membre canònic mitjançant `nex_ci_authorize_canonical_family_locked` i conserva el bloqueig durant la consulta; filtra per `family_id`, expiració i cursor; limita a 20 missatges. El rol runtime té només `EXECUTE` i no pot fer `SELECT` directe a les taules.
- `tests/sql/whatsapp-family-inbox-reader-rpc-smoke.sql` prova en PostgreSQL 17 dues famílies fictícies, autorització revocada, paginació i denegació dels rols sense permisos. La capa JS continua provant desxifrat AES-GCM, manipulacions i sessió revocada, també amb dades sintètiques.
- **Nova protecció signada (12/11/2026):** `lib/whatsapp/signed-inbox-read-permit.js` genera una autorització HMAC SHA-256 d'un sol ús, de 30 segons, lligada a `userId` canònic, `familyId`, hash de sessió, cursor, límit, nonce i identificador de clau activa. La signatura només s'emet després de verificar sessió i família; es torna a validar sessió i pertinença després d'obtenir la clau i després de la consulta SQL.
- `db/migrations/20261112_whatsapp_signed_family_inbox_reader_ci.sql` incorpora en PostgreSQL efímer `nex_ci_signed_read_family_whatsapp_inbox`: comprova HMAC, expiració, clau no revocada, bloqueig del membre canònic i unicitat de nonce; **revoca l'EXECUTE sobre la funció antiga sense signatura** per al rol runtime. Cap lectura directa de taules ni de claus de signatura. `tests/sql/whatsapp-signed-family-inbox-reader-smoke.sql` comprova suplantació, camps alterats, replay, clau revocada i membre suspès.
- **Bloqueig de seguretat pendent abans de Neon:** el mòdul JavaScript és experimental i el servidor ha de verificar realment l'IdP; l'HMAC no converteix per si sol una sessió no verificada en identitat fiable. Cal una custòdia de claus segregada de les credencials de lectura, rotació i revocació operacional, control d'auditoria de permisos i prova integrada amb Neon Auth. Una intrusió al procés que té la clau de signatura encara pot emetre autoritzacions: cal revisar aquest risc, privilegi mínim i segmentació abans del pilot.
- Cap dels dos scripts `*_ci.sql` és una migració aprovada per Neon. **NO GO** de SQL real, de serveis Meta i d'exposició pública.

### 2. Vercel preview (NO GO)

**Inspecció real de només lectura, 12/11/2026:** `primer-projecte` té previews de la PR #15 en estat `READY`, inclosa la del commit `5b23661d`; aquesta és anterior a l'últim codi de lectura signada i no l'acredita. `nexlupa-forwarding-gateway`, projecte Vercel **separat** creat per al pilot Gmail/forwarding, falla en construir perquè els logs indiquen literalment `The specified Root Directory "gateway" does not exist. Please update your Project Settings.` Aquesta és una configuració de directori Git del projecte gateway, no una fallada del test PostgreSQL/WhatsApp. El projecte gateway informa `live:false`; la producció principal no s'ha modificat.

- Auditar el checkout real que correspon al projecte gateway, decidir si la carpeta `gateway` s'ha de crear en una branca pròpia o si el root configurat és incorrecte, i validar una compilació **només preview**. No canviar el directori arrel compartit ni publicar serveis fins a revisar l'impacte sobre Gmail.
- Comprovar que un commit actual de la PR #15 genera una nova preview `READY`; el codi JavaScript i SQL de CI no són prova de desplegament live.
- Comprovar que l'origen de prova és HTTPS i coincideix amb el host exacte autoritzat; que el build de producció no inclou el pilot; que API, credencials i fitxers SQL no són recursos estàtics.
- Validar dos comptes ficticis autoritzats amb el servei Neon Auth de preview, amb galeta HttpOnly, expiració i tancament de sessió verificats; un tercer compte desconegut s'ha de rebutjar.
- No crear una ruta pública de consentiment fins que totes les proves d'identitat, CSRF, doble ús i revocació passin en preview.

### 3. Meta de proves (NO GO)

- Verificar la propietat del compte Business, el número de prova oficial i el token de validació en un entorn de Meta que no rebi converses de producció.
- Provar, amb esdeveniments ficticis, validació de signatura sobre bytes originals, identificador de missatge Meta, número de destí, redelivery i timestamps. Mai confiar en un número que vingui del navegador.
- Confirmar que completar el pairing només produeix la prova de control del número i **no** dóna accés a missatges fins a rebre consentiment web explícit i complet.
- Establir política de grups, consentiment de tercers i de dades de menors; no executar ingestió de grups amb participants reals en aquest pilot.

### 4. Pilot E2E autoritzat (NO GO)

- Preparar dues famílies fictícies, dos administradors de prova, un membre sense privilegis i un remitent desconegut.
- Validar els camins: pairing → rebut explícit → alta; revocació a meitat de flux; dues altes simultànies; prova caducada; intercanvi de justificants entre famílies; rollback després d'una fallada SQL; tancament de sessió.
- Confirmar esborrat i terminis de retenció dels rebuts, proves telefòniques i registres de webhook; auditar-los sense imprimir dades personals ni secrets als logs.
- Documentar incidències i aprovació expressa abans de qualsevol pilot amb persones.

## Decisió operativa

**NO GO actual**. El fet de superar CI no és autorització per desplegar. La següent tasca executiva segura és preparar migracions i proves per a un entorn de preview completament aïllat, amb revisió independent dels permisos i de la privacitat. No fusionar PR #15, no executar SQL a Neon real ni activar Meta.

Referència de codi: [PR #15](https://github.com/DavidParet/Primer-projecte/pull/15).
