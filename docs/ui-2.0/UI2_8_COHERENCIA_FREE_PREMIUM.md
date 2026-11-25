# NexLupa · UI 2.8 — Coherència FREE / Premium 1.0

Branca `ui-2.0` · Interfície 2.8.0 (actualitzat a 2.8.1: retirat «Altres correus / Outlook», que no consta a l'acta) · 2026-11-25 · Main i producció sense canvis.

**Fonts:**
- Acta estratègica amb addenda, incloent-hi l'actualització de coherència del 25/11/2026.
- Encàrrec únic del vídeo del 24/11/2026.
- Decisió de David: les imatges i les captures són exclusives de Premium.

La transició d'anàlisi (lupa, llum, X i implosió) no s'ha tocat.

## Taula final

| Funció | FREE | Premium 1.0 |
|---|---|---|
| Anàlisi de text (copiar i enganxar) | ✓ 3 al dia | ✓ 1.000 al mes, correus inclosos (previst) |
| Anàlisi d'imatges i captures | — No inclòs | ✓ 50 al mes (previst) |
| Resum, accions i prioritats, dates, terminis, imports i ubicacions | ✓ | ✓ |
| Tasques i historial | ✓ | ✓ |
| Compartir el resultat per WhatsApp | ✓ | ✓ |
| Obrir ubicacions a Maps | ✓ | ✓ |
| Afegir manualment a Google Calendar | ✓ | ✓ |
| Gmail amb reenviament selectiu automàtic | — | ✓ (previst) |
| Recordatoris de terminis per correu | — | ✓ (previst) |
| Informe setmanal PDF | — | ✓ (previst) |

Llegenda a la pantalla: «✓ inclòs al pla · "previst": inclòs a Premium 1.0, encara no disponible».

Els preus, la prova de 14 dies i les quotes es mostren com a previstos, sense canvis. L'avís al mòbil de tasques noves i la sincronització automàtica del calendari no apareixen com a funcions disponibles.

## Correccions aplicades
- **Comparativa:**
  - «Text» i «Imatges i captures» ara són files separades.
  - S'ha afegit la fila «Informe setmanal PDF», amb l'estat «previst».
  - Marca verda quan el pla inclou la funció; límits en text neutre; guió neutre quan no està inclosa.
  - S'ha tret la creu de «Amb el FREE, 3 anàlisis de text al dia».
- **Inici:**
  - La pestanya diu «Imatge · Premium».
  - Per al FREE, prémer-la mostra «L'anàlisi d'imatges i captures és exclusiva de Premium 1.0, que arribarà properament» i un botó «Veure Premium».
  - No es mostra la zona de càrrega ni el botó d'analitzar.
- **Altres entrades d'imatge al client:** el selector de fitxers, arrossegar i deixar anar, i qualsevol intent de forçar l'anàlisi queden bloquejats.
- **Servidor (`api/analyze.js`):** qualsevol petició amb imatge es rebutja (403 `PREMIUM_REQUIRED`) abans de cridar el model. No es llegeix cap indicador de pla enviat pel navegador.
- **Textos:**
  - «NexLupa» al títol, la benvinguda, el lema, el peu, la configuració, la insígnia Premium i el text de compartir. El logotip gràfic neXlupa es conserva.
  - Avís de límit: «Torna demà per 3 anàlisis de text més».
  - Benvinguda: «Tot sincronitzat» passa a «Calendar, WhatsApp i historial», amb «afegeix manualment», perquè no faci pensar en una sincronització automàtica.

## Verificat
**Proves automàtiques:** `npm test` 274/274.
- El servidor rebutja una imatge sense permís sense consumir l'API: cap crida al model.
- Un indicador `premium: true` enviat pel navegador, o una capçalera de pla, no obre les imatges.
- El text continua funcionant.
- No hi ha textos de «FREE inclou imatges» ni límits gratuïts en vermell.

**Proves de navegador:** E2E 43/43, que confirma que Calendar manual, Maps, Tasques i Historial continuen funcionant al FREE.

**Navegador a 360, 390 i 412 px, i a 390 px amb zoom al 115 %:**
- panell Premium visible, sense zona de càrrega;
- després d'un fitxer o d'arrossegar una imatge no queda cap imatge carregada;
- anàlisi forçada: 0 crides a l'API i missatge d'error;
- cap desbordament i cap text vermell a la pàgina Premium.

## Bloquejos pendents
1. **No hi ha sistema de comptes ni permisos** (Fase 1 de l'acta).
   - El servidor no pot verificar cap usuari Premium. Per això ara rebutja totes les imatges.
   - L'exclusivitat queda garantida (ningú no les pot usar), però **l'anàlisi d'imatges per a Premium no està habilitada**.
   - Quan hi hagi comptes, s'ha d'implementar `hasVerifiedPremium(req)` amb la sessió real.
2. **Quota FREE de 3 anàlisis de text al dia:**
   - ara només hi ha un comptador al navegador;
   - amb `DEV_MODE = true` el límit està desactivat en aquesta versió de prova;
   - el límit al servidor requereix comptes.
3. **Funcions Premium no implementades:** Gmail, recordatoris per correu, informe PDF i quotes. Es mostren com a «previst».

## Discrepàncies per revisar
- **App:** la fila i la fitxa «Altres correus / Outlook: reenviament manual» i la frase «Amb altres proveïdors, es preveu el reenviament manual» no consten a l'acta. Es mantenen com a «previst» fins que David decideixi.
- **Vídeo V9f:** inclou una pantalla d'anàlisi de fotos. Segons l'acta, si es mostren imatges o captures cal identificar-les com a Premium. Cal revisar-ho al muntatge.
- **Vídeo (encàrrec del 24/11):** el recorregut FREE ha de ser de text, i les imatges només poden aparèixer marcades com a Premium.
