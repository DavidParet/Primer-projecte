# NEXLUPA · Posada en marxa del primer Gmail pilot

**Estat:** document preparat; **no hi ha cap compte Gmail real connectat, cap credencial de Google configurada ni cap flux publicat**. Manteniu desactivat `GMAIL_PILOT_ENABLED` fins que tots els controls estiguin validats.

## Decisió d'abast

- Una família pilot autoritzada, un usuari verificat i una sola etiqueta **NEXLUPA_PILOT** a Gmail.
- Lectura manual i puntual de **fins a 3 missatges** de text pla. Sense adjunts, HTML, IA, reenviaments, esborraments o operacions de Calendar.
- Tokens efímers de Google: no es desen tokens de renovació. L'autorització exigeix una sessió familiar de Neon Auth i una galeta d'estat HttpOnly de 4 minuts.
- Primera previsualització per a revisió humana: no equival a una fitxa processada automàticament.

## Ordre exacte de configuració

### 1. Domini HTTPS de prova estable (Vercel)

Escollir i verificar un únic domini HTTPS **de preview** abans de crear OAuth. Cal que el domini d'origen i el de retorn siguin exactament el mateix. La ruta programada és:

`https://DOMINI_PREVIEW/api/gmail/pilot/callback`

No feu servir una URL efímera que canviï a cada desplegament: Google compararà el redirect URI amb coincidència exacta. Cal desplegar les rutes `/api/gmail/pilot/start`, `/api/gmail/pilot/callback` i `/api/gmail/pilot-auth` al projecte **privat** de validació, mai directament a la web pública.

### 2. Google Cloud

En un projecte de Google Cloud controlat per l'operador del producte:

1. Habilitar **Gmail API** dins d'APIs & Services.
2. Configurar **Google Auth Platform → Branding / Audience / Data Access** (el nom dels apartats pot variar a la consola). Utilitzar mode de prova amb un compte pilot explícit.
3. Declarar només els permisos necessaris: `openid`, `email` i `https://www.googleapis.com/auth/gmail.readonly`. No habilitar `gmail.modify`, `gmail.send` ni Calendar.
4. Crear un **OAuth client ID de tipus Web application**.
5. A **Authorized redirect URIs**, introduir exactament el redirect HTTPS fixat al pas 1.
6. Desar Client ID i Client Secret com a secrets xifrats de Vercel. **No enganxar-los en xats, issues, documents o al repositori.**

**Important:** `gmail.readonly` és un scope **restringit**. Abans d'obrir l'accés al públic, Google pot requerir verificació OAuth i, si les dades es transmeten o emmagatzemen en servidors, una avaluació de seguretat.

### 3. Neon Auth, família i consentiment

- La branca de proves ja té Neon Auth i les funcions RPC de comprovació i consum únic.
- Crear **només** el compte pilot aprovat, verificar-ne la identitat i activar el vincle amb la família corresponent mitjançant un procediment d'administració auditable. No confiar en `familyId` enviat pel navegador.
- Registrar consentiment explícit `gmail_oauth / read_school_mail`; fer que la revocació sigui efectiva abans i durant el processament.
- Confirmar que el rol de servidor només pot executar les RPC concedides; no pot llegir ni editar taules familiars directament.

### 4. Variables d'entorn (només preview)

| Variable | Origen |
|---|---|
| `GMAIL_PILOT_ENABLED` | Inicialment `false`; activar únicament quan el pilot estigui autoritzat |
| `GOOGLE_CLIENT_ID` | Client OAuth Web de Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Secret del client OAuth, encriptat |
| `GMAIL_PILOT_REDIRECT_URI` | URL HTTPS exacta del callback |
| `GMAIL_PILOT_DATABASE_URL` | Rol restringit de la branca de Neon |
| `NEON_AUTH_BASE_URL` | Neon Auth de la branca de proves |
| `NEON_AUTH_JWKS_URL` | JWKS públic del mateix emissor de proves |

### 5. Prova funcional

1. Al Gmail pilot crear manualment l'etiqueta `NEXLUPA_PILOT` i assignar-la a 1-3 correus **ficticis**, sense dades personals de menors.
2. Iniciar sessió a NexLupa pilot amb una família verificada.
3. Autoritzar la petició Google i comprovar que la galeta de navegador i l'estat d'un únic ús coincideixen.
4. Confirmar que es mostra una previsualització de 1-3 missatges, **sense fitxes persistents, enviaments ni Calendar**.
5. Comprovar que un segon ús del callback, una família sense consentiment o una etiqueta absent són rebutjats.
6. Revisar logs i base de dades: cap token, contingut de missatges, acció de Calendar ni missatge enviat per error.
7. Revocar l'accés al pilot i confirmar que s'aturen les noves consultes.

## Verificació existent

- **140/140 proves** automatitzades de codi superades a GitHub Actions, incloent un recorregut complet amb Google OAuth i Gmail **simulats**.
- El workflow de seguretat és `.github/workflows/gmail-pilot-tests.yml`.
- Desenvolupament en PR #9, en esborrany. Bloqueig de desplegaments Vercel 402 `api-deployments-free-per-day`.
- **Cap lectura Gmail real encara.**

## Enllaços de referència

- Google OAuth web: https://developers.google.com/identity/protocols/oauth2/web-server
- Restriccions d'abast Gmail: https://developers.google.com/workspace/gmail/api/auth/scopes
- PR de desenvolupament: https://github.com/DavidParet/Primer-projecte/pull/9
- Seguiment de bloquejos: https://github.com/DavidParet/Primer-projecte/issues/12

## Auditoria de seguretat i consolidació

- Únic circuit OAuth admès: `/api/gmail/pilot/start` i `/api/gmail/pilot/callback`.
- Les antigues rutes paral·leles `/api/gmail/start` i `/api/gmail/callback` s'han retirat de la branca de preparació, juntament amb els mòduls i proves duplicats.
- El punt d'inici exigeix POST JSON, `Origin` i `Host` coincidents amb l'HTTPS de prova, JWT signat de Neon Auth i família autoritzada per SQL.
- `GMAIL_PILOT_DATABASE_URL` es limita estrictament a rol `nexlupa_gmail_auth_preview`, base `nexlupa_pilot` i servidor Neon verificat per TLS `verify-full`.
- Validació real contra la branca de Neon: rol correcte, sense ús directe de l'esquema de famílies i identitat sintètica no vinculada denegada.
- `api/gmail/pilot-auth.js` rebutja l'entorn de producció i qualsevol POST de pilot desactivat.
- Bateria local de seguretat **140/140 correcta** (mock de Google i Gmail); la verificació de base de dades Neon anterior és real.
- No s'ha autoritzat cap Gmail ni s'ha desplegat la funcionalitat a la web pública.

**Proposta en desenvolupament:** `chore/gmail-canonical-route-20261109`. Incorporar primer a la branca funcional `feature/gmail-readonly-pilot-20261109`; mai a `main` sense aprovació.

## Comprovació de compilació de Vercel

- S'ha corregit només a la branca Gmail la sintaxi heredada dels patrons de capçaleres de `vercel.json`, mantenint els mateixos temps de memòria cau per HTML, CSS, JS i imatges.
- Els 10 patrons passen el compilador `path-to-regexp` i **140/140 proves automàtiques** han finalitzat correctament.
- El nou estat Vercel és de **límit de compilacions del compte (`build-rate-limit`)**, no de sintaxi de rutes. No s'ha modificat el pla ni la producció.
- La comprovació PostgreSQL real amb rol restringit i TLS estricte ha confirmat: identitat fictícia sense autorització, accés directe a dades familiars denegat.
- Neteja OAuth a la branca de desenvolupament integrada mitjançant el PR #14. El PR #9 continua en esborrany.
