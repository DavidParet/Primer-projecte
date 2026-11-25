# NexLupa UI 2.0 — canvis, proves i guia d'auditoria

**Branca:** `ui-2.0` · **Base:** `fix/qa96-deterministic-dates-20261112` @ `220e252` (motor QA96 més recent, 23-11-2026)
**Referència visual oficial:** vídeo comercial V9f (aprovat 25-11-2026) — «adaptar l'aplicació al vídeo, no el vídeo a l'aplicació».
**Estat:** preview independent a Vercel — `https://primer-projecte-git-ui-20-davidparets-projects.vercel.app/app/` (desplegament `dpl_EQLbMkmhDtNEtWx7LVZmA7DfUvzS`, destí *preview*, commit `290ee50`; protegida per l'autenticació de Vercel, `x-robots-tag: noindex`). **Producció NO modificada** (`main` intacta; Vercel només desplega `main` a producció).

---

## 1. Principi d'implementació

La UI 2.0 és una **capa visual independent** que s'aplica per sobre de l'aplicació actual:

| Fitxer | Què fa |
|---|---|
| `app/ui2.css` (nou) | Paleta, tipografia, targetes, botons, xips de prioritat, Tasques, Premium, animació. Tot sota `body.ui2`. |
| `app/ui2.js` (nou) | Observa el DOM que ja genera `script.js` i hi aplica icones lineals, comptadors de prioritat, el distintiu «Anàlisi completada» i l'animació corporativa lupa + X. |
| `app/assets/ui2-lupa.png`, `ui2-logo.png` (nous) | Retalls del **logotip oficial** (PNG de marca del Drive). No s'ha redibuixat res. |
| `app/index.html` | +1 tipografia (Inter), +`ui2.css`, +`ui2.js`, `class="ui2"` al `<body>`, i s'eliminen els 2 rètols de depuració «BUILD …» que es veien a sobre de la navegació. |
| `scripts/build-static.js` | Afegeix els 4 fitxers nous a la llista de publicació. |
| `tests/ui2-contract.test.js` (nou) | 6 proves estàtiques (dins `npm test`). |
| `tests/e2e/` (nou) | Proves de navegador (25 comprovacions) amb respostes simulades deterministes. |

**No s'ha tocat:** `api/analyze.js`, `lib/nexlupa-result.js`, `lib/date-evidence.js`, `app/script.js`, `vercel.json`, `package.json`, cap prova existent, cap integració (Gmail, WhatsApp, Resend), cap secret ni variable d'entorn.

`git diff 220e252 -- api lib app/script.js tests/*.test.js` → **buit** excepte la prova nova `tests/ui2-contract.test.js`.

**Reversibilitat:** treure `class="ui2"` del `<body>` (o les dues línies `ui2.css` / `ui2.js`) torna exactament a la UI anterior. Si `ui2.js` fallés o no es carregués, l'aplicació funciona igual (no hi ha cap dependència en sentit contrari).

## 2. Recursos reutilitzats del vídeo V9f

| Element del vídeo | A l'app |
|---|---|
| Paleta: navy `#0D1B2A`/`#122233`, daurat `#F5C518`/`#D4A830`, gris `#9AA5B4` | Variables CSS a `body.ui2`; fons radial idèntic al vídeo |
| Prioritats P1 `#ef4444` (etiqueta `#f87171`) · P2 daurat · P3 gris | Xips de secció, franja lateral de cada targeta, dates, Tasques |
| Tipografia Inter (titulars blancs, frases clau en daurat) | Tota l'app (el logotip continua sent la imatge oficial) |
| Targetes radi 18–20 px, vora translúcida, ombra suau | Targetes d'entrada, resultats, esdeveniments, Tasques, Premium |
| Icones lineals (traç arrodonit) del vídeo: signar, pagar, alerta, motxilla, rellotge, escola, calendari, ubicació, correu… | Targetes P1/P2/P3 (tria per contingut), xips de data/hora/lloc, botons Calendari/Maps, navegació inferior |
| Distintiu «✓ Anàlisi completada» + bloc RESUM amb vora daurada | Bloc «En resum» |
| Xip «FREE» blanc · Premium amb brillantor daurada | Comptador FREE, franja i pàgina Premium 1.0 (reflex daurat subtil) |
| **Animació corporativa**: lupa oficial escaneja → frases en daurat → l'ombrejat s'esvaeix → energia cap a la X → explosió de llum → emergeix el resultat | Substitueix el «🔍 Analitzant…» mentre la crida a `/api/analyze` està en curs |

### Animació d'anàlisi (detall tècnic)
- S'activa quan `#loading` rep la classe `on` (la posa `script.js`) i acaba quan `#results` rep `on`.
- Mentre l'API treballa, la lupa recorre el text enganxat i il·lumina dates, hores, imports, terminis, «autorització» i «al·lèrgia» (expressió regular només visual; **no afecta l'anàlisi**).
- Durada mínima 1,7 s (si l'API respon molt ràpid, l'animació no «parpelleja»); final: convergència a la X ≈0,4 s + explosió ≈0,7 s + fosa 0,45 s.
- Error de l'API: la capa es retira i es mostra l'error habitual.
- `prefers-reduced-motion`: sense animacions, mateix resultat.
- Text mostrat: escapat (sense HTML injectable).

### Comptadors de prioritat
Cada xip (P1, P2, P3) mostra el **total de targetes d'aquella prioritat dins dels resultats**, incloses les plegades a «Veure-les totes». Exemple (missatge escolar): P1 = 2, P2 = 2 (1 visible + 1 plegada), P3 = 2. Els comptadors es calculen sobre el DOM que genera el motor; no fan cap càlcul de prioritat propi.

## 3. Proves executades

| Prova | Resultat |
|---|---|
| `npm test` (253 originals QA96 + 6 noves UI2) | **259/259** ✓ |
| `node --check` (api, lib, app/script.js, app/ui2.js) | ✓ |
| Build de Vercel en còpia neta (`inject-version` + `build-static`) | ✓ 18 fitxers a `public/` |
| `python3 tests/e2e/ui2_e2e.py` (navegador, API simulada) | **25/25** ✓ |

Escenaris E2E: A missatge escolar (P1/P2/P3 = 2/2/2, comptadors iguals, terminis exactes 4, 10 i 2 de desembre, esdeveniment 18-12 08:15 i 22-12 13:00, Tasques desa 6 accions, sense errors JS) · B termini vençut («Termini vençut» i «Fins:» conservats, comptadors 1/1) · C sense accions («No has de fer res», sense P1) · D error 500 (capa retirada, error visible, formulari restaurat) · E resposta en 50 ms (temps mínim d'animació) · F moviment reduït · G responsive 360×740, 412×915, 768×1024, 1280×860, 1920×1080 (sense desbordament horitzontal a cap pàgina).

**No executat:** la bateria real `tests/run-qa50.js` contra OpenAI (requereix clau i té cost). No cal per a aquest canvi perquè el motor és idèntic, però l'auditor la pot executar a la preview.

## 4. Incidències detectades

1. **Tasques (preexistent a producció):** les tasques de prioritat baixa es pintaven `#2e2e2e` sobre fons fosc (pràcticament invisibles) perquè `renderTasques()` tria el color amb `body.dark`, que l'app no activa per defecte. **UI 2.0 ho corregeix visualment** (CSS); la lògica no s'ha tocat. Recomanació: revisar-ho també a `script.js` quan es fusioni.
2. **Rètols de depuració a producció:** «BUILD MOBILE POLISH OK» i «BUILD 2026-06-01 — subtítol proper» es veuen a sobre de la navegació inferior. Eliminats a `ui-2.0`.
3. **`main` està per darrere del motor QA96** (`main` = 09-11; QA96 = 23-11). Abans de passar UI 2.0 a producció cal integrar primer la branca QA96 a `main` (decisió d'Oz).
4. **Previews:** `vercel.json` desactiva els desplegaments automàtics de totes les branques excepte `main`. La preview de `ui-2.0` s'ha de crear manualment (no s'ha canviat `vercel.json`).
5. **Emojis residuals** en llocs secundaris (pestanyes «✏️ Text / 📷 Imatge», capçaleres de Configuració i Historial, botó «💬 Compartir»). Es poden substituir en una segona passada.
6. **Contingut Premium sense canvis de text:** la pàgina Premium manté els textos actuals (preu previst, «PROPERAMENT»). UI 2.0 només en canvia l'estètica.
7. **Pantalles conceptuals del vídeo** (Gmail automàtic, anàlisi de fotografies, anàlisis il·limitades, recordatoris, PDF setmanal) **no s'han presentat com a funcions**: no s'han afegit a l'app.

## 5. Com auditar (per a ChatGPT o qualsevol revisor)

```bash
git fetch origin ui-2.0 fix/qa96-deterministic-dates-20261112
git diff origin/fix/qa96-deterministic-dates-20261112..origin/ui-2.0 --stat
git diff origin/fix/qa96-deterministic-dates-20261112..origin/ui-2.0 -- api lib app/script.js   # ha de ser buit
npm test                                      # 259/259
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e/ui2_e2e.py                 # 25/25 (Chromium de Playwright; o CHROME=/ruta/a/chrome)
```
Punts a verificar: (1) el motor no canvia cap resultat; (2) comptadors = targetes; (3) dates i terminis idèntics a la UI anterior; (4) cap crida de xarxa nova; (5) accessibilitat amb moviment reduït; (6) mòbil Chrome Android, Edge i escriptori (norma 7 de `docs/process/nexlupa-development-rules-v1.md`).

## 6. Pendent de decisió d'Oz
- Validar la preview en un mòbil real (Chrome Android i Samsung Internet).
- Segona passada d'icones (punt 5) i, si es vol, redisseny de Configuració/Historial.
- Ordre de fusió: QA96 → `main`, i després `ui-2.0` → `main`.
