# NexLupa · QA50 + Claude independent · Protocol operatiu

Estat: preparat en PR de revisió; **no activat a producció**.

## Objectiu
1. ChatGPT corregeix codi en una branca, mai sobre producció.
2. GitHub Actions comprova sintaxi i regressions de cada PR sense desplegar.
3. El motor NexLupa real processa els **mateixos 50 missatges** del 12/11/2026 amb data fixa **Europe/Madrid**.
4. Claude examina el missatge, la sortida REAL del motor i l'esperat; un HTTP 200 **no** implica un encert.
5. No es publica res automàticament. Una revisió amb **50 PASS / 0 WARN / 0 FAIL** és necessària abans de proposar publicació, i la decisió de publicar continua en mans del propietari.

## Activació segura
Aquest repositori de GitHub és públic. Els missatges originals (que poden contenir dades escolars i contactes) **no s'han de pujar al repositori** ni als artefactes públics.

Configurar a GitHub → Settings → Secrets and variables → Actions → Repository secrets:
- `QA50_FIXTURES_GZIP_B64`: Base64 de la fixture JSON original de 50 casos, comprimida amb gzip (generada en fitxer privat, no compromesa al repositori)
- `NEXLUPA_QA_URL`: URL HTTPS d'una versió autoritzada per a proves; el runner utilitza `/api/analyze`
- `NEXLUPA_QA_KEY`: clau d'accés al mode QA del motor, que fixa la data de referència
- `ANTHROPIC_API_KEY`: clau Anthropic per a la revisió de Claude
- Opcional `VERCEL_AUTOMATION_BYPASS_SECRET`: per a previsualitzacions protegides

Variable opcional del repositori: `CLAUDE_MODEL` (per defecte `claude-opus-5-5`; convé fixar una versió compatible).

**No introduir cap secret en un fitxer del repositori ni en una conversa.** El responsable els configura en la interfície de GitHub. Verificar sempre que `NEXLUPA_QA_URL` apunta a la versió que es vol auditar, no una antiga.

## Execució
- GitHub Actions: `NexLupa - validacions sense desplegament` comprova PRs amb sintaxi JavaScript, smoke tests i parser de resultats. **No fa deploy**.
- `NexLupa - QA50 real i auditoria Claude`: execució manual i, després que la PR estigui aprovada i fusionada, **cada dia a les 06:17 UTC**. S'executa contra l'URL de QA configurada; no fa deploy ni promoció.
- Límit per execució: **50 trucades a NexLupa i com a màxim 10 lots de Claude de fins a 5 casos**; com a màxim una execució simultània, 45 minuts.
- Si falta un secret, falla la xarxa, Claude retorna dades mal formades, falten casos, o algun cas no és PASS: **auditoria no vàlida / publicació bloquejada**.
- A GitHub només es publica el resum per número de cas i àrea, mai el missatge ni la resposta íntegra; el runner elimina els JSON privats després d'executar.
- El document complet original de Claude es conserva privadament a la biblioteca del projecte; els resums de GitHub són deliberadament reduïts per privacitat.

## Línia base (Claude, versió bzvlmue46)
- 17 PASS (34 %), 17 WARN (34 %), 16 FAIL (32 %).
- 27 casos de correu, 23 de WhatsApp.
- Causes a vigilar: dates relatives, incoherències dia/data, pèrdua d'enllaços/imports, múltiples esdeveniments, accions inventades, ubicacions no verificables.
- No atribuir els nous resultats a la versió recent fins que s'hagi executat l'endpoint REAL amb claus vàlides.

## Cost i seguretat
La clau d'API de Claude té un cost de consum separat del pla ChatGPT. No hi ha cap connector Claude autenticat al compte en aquesta configuració. Per això **aquesta PR prepara el mecanisme però encara NO demostra 50 proves reals d'auditoria Claude automatitzada**.

El desplegament de Vercel per GitHub continua sent una via separada; evitar desplegar per duplicat i aplicar aprovació abans de moure `main`. Si hi ha una segona vinculació Vercel al mateix repositori, revisar-la abans d'activar més desplegaments.
