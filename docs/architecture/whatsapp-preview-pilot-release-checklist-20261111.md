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

**Inspecció real de només lectura, 11/11/2026:** el projecte `nexlupa-resend-pilot` conté una branca principal amb la cua de Resend i branques descendents amb taules `neon_auth` i de WhatsApp. Les branques existents **no són un entorn inicial buit**. És preferible preparar un projecte sandbox nou i verificar-ne l'absència de dades abans de clonar cap branca. Vegeu la [inspecció i pla d'aïllament](./whatsapp-neon-isolation-readonly-audit-20261111.md). La creació encara requereix autorització i no s'ha executat.

- Confirmar una branca de prova sense còpia de dades familiars, missatges, correus, telèfons ni identificadors reals.
- Preparar scripts per a preview **diferents** dels `*_ci.sql`; aquells fitxers són exclusius d'un PostgreSQL efímer i contenen rols `nex_ci_*` no aptes per aplicar a Neon real.
- Revisar migració d'anada i retirada, rol runtime restringit, RLS, `SECURITY DEFINER`, drets sobre seqüències, permisos que poden heretar rols i rotació de claus.
- Definir proves de rollback i destrucció del conjunt de dades fictícies. No executar sense revisió i aprovació específica.

### 2. Vercel preview (NO GO)

- Resoldre la limitació actual de compilacions per poder verificar una preview real.
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
