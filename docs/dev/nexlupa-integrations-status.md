# NexLupa · Coordinació d'integracions Gmail / WhatsApp

**Auditoria inicial:** 2026-11-09 (Europa/Madrid). **Estat:** desenvolupament privat; cap autorització per fusionar o activar producció.

## Font de veritat i dependències

- Repositori: `DavidParet/Primer-projecte`. El `main` **no conté** les implementacions noves de Gmail ni de WhatsApp: són PR esborranys separats. No treballar sobre `main` assumint que els canvis hi són.
- **Gmail**: PR #9, branca `feature/gmail-readonly-pilot-20261109`, draft. El PR documenta 94 proves sintètiques i CI correcta; no s'ha llegit cap correu real. La configuració OAuth Google, els consentiments, un usuari pilot autoritzat i una preview verificable continuen pendents. La recepció de correus a Resend no és equivalent a llegir Gmail per OAuth.
- **WhatsApp**: PR #5 parser offline d'exportacions; PR #6 webhook Meta amb signatura i mode desactivat; PR #7 safata duradora i SQL de consentiments; PR #8 política d'alta/baixa. Dependències apilades **#8 → #7 → #6**; la #5 és independent. Cap d'aquestes PR s'ha de fusionar o desplegar automàticament.
- **Vercel**: `primer-projecte`, `nexlupa-resend-pilot` i `nexlupa-worker-validation` tenen desplegaments registrats en estat READY en la consulta de 2026-11-09. READY només acredita l'estat de desplegament; no verifica una prova funcional de les noves integracions. No modificar dominis de producció.
- **Neon**: la documentació de PR #8 declara una branca de proves SQL separada, amb dades fictícies; no confondre-la amb la base productiva. Verificar sempre projecte i branca abans d'escriure.

## WhatsApp · proper pas segur

**Bloqueig de producte crític:** l'API de WhatsApp Business i el webhook d'un número empresarial no donen accés general als missatges dels grups privats de WhatsApp de les famílies. No vendre ni implementar «sincronització automàtica de grups existents» sense un mecanisme oficial i autoritzat. El parser d'exportació voluntària (#5) és una via pilot separada; per missatges enviats directament al número empresarial, cal consentiment i una política de tercers.

**Bloqueig de seguretat identificat a #8:** `makeConsentPolicy.enroll` valida prova del control del número, però **no verifica una acceptació explícita i auditable de la política**. El camp `consent_version` prové de l'entrada i el `consent_source` es fixa a `verified-phone-challenge`; provar el número no equival a acceptar el tractament de dades. No activar aquest mòdul amb dades reals.

**Propera tasca d'implementació (en branca de WhatsApp, sense alterar Gmail):**
1. Afegir adaptador fiable `verifyExplicitConsent` lligat a sessió, família, compte empresarial, abast i versió exacta de la política; comprovar prova no reutilitzable, hora i origen.
2. Fer que `enroll` rebutgi sense executar SQL quan el consentiment és absent, caducat, d'una altra família o d'una altra versió. El consentiment no ha de ser un simple booleà lliurat pel navegador.
3. Guardar evidència auditable sense dades de missatges; definir revocació i esborrat de dades preexistents. Cobrir amb proves sintètiques i CI.
4. Després, provar l'API només en preview segura; no connectar Meta ni acceptar POST reals fins que persistència, idempotència i autorització estiguin demostrades.

## Gmail · proper pas segur

1. Mantenir PR #9 en draft, sense dades reals ni secrets al repositori.
2. Validar la preview HTTP i els tests aïllats; després configurar client OAuth Google de proves amb URI exacta i compte pilot autoritzat.
3. Revisar restriccions de l'scope `gmail.readonly`, revocació, retenció i separació per família abans de llançar beta.
4. No utilitzar el Gmail personal del propietari com a corpus de desenvolupament.

## Normes per als dos agents / xats

- Cada nova sessió ha de comprovar PRs i commits recents abans de modificar res.
- Treballar en branques independents, fer PR draft i no tocar `main` ni producció.
- Comunicar només **canvis verificats** amb enllaç a PR/commit/CI, o bloqueig precís. Una nota de disseny no és una funcionalitat desplegada.
- Si aquest fitxer viu en una branca apilada sobre #8, **no fusionar-lo directament a main**: traslladar-lo a la branca de coordinació definitiva quan s'aprovi l'arquitectura.
