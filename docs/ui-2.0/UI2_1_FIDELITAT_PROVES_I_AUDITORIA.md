# NexLupa UI 2.1 — Fidelitat gràfica al vídeo V9f: canvis, proves i guia d'auditoria

**Branca:** `ui-2.0` · **Referència UI 2.0 conservada:** branca `ui-2.0-ref` (commit `c02fa80`). L'etiqueta `ui-2.0-ref` també existeix en local; el servidor no ha acceptat la pujada d'etiquetes.
**Base del motor:** `fix/qa96-deterministic-dates-20261112` @ `220e252` (sense cap canvi).
**Guia gràfica:** pantalles del vídeo V9f «Tasques i prioritats», «Calendari», «Resum», fitxes de dades de l'«Anàlisi de fotografies», FREE, PREMIUM 1.0 i l'animació de la lupa i la X.
**Estat:** preview independent. `main` i producció no s'han tocat. La protecció SSO de Vercel tampoc.

## 1. Confirmació: el motor QA96 no s'ha modificat
```
git diff fix/qa96-deterministic-dates-20261112..ui-2.0 -- api lib app/script.js vercel.json package.json tests/*.test.js(excepte ui2-contract)  →  buit
```
Els límits dels plans, les integracions, la seguretat, les estructures de dades i la lògica d'anàlisi tampoc han canviat. La UI només **llegeix** `_historial` i `_allTasques` (variables globals de `script.js`) per mostrar dades que ja existeixen.

## 2. Fitxers modificats (UI 2.0 → UI 2.1)
| Fitxer | Canvi |
|---|---|
| `app/ui2.css` | Reescrit: sistema gràfic del vídeo (fons amb profunditat i reflexos daurats estàtics, targetes amb volum, franja de prioritat gruixuda, requadres de pictogrames, calendari, fitxes de dades, Tasques, Historial, Configuració, Premium, animació). |
| `app/ui2.js` | Reescrit: pictogrames del vídeo segons el contingut real, etiquetes P1/P2/P3, comptadors, fitxes del Resum, calendari (caixa de data i hora), llista de **terminis** separada dels esdeveniments, vista «Tasques i prioritats», substitució d'emojis, animació corregida, reversibilitat. |
| `tests/ui2-contract.test.js` | +2 proves (reversibilitat, indicador original). |
| `tests/e2e/ui2_e2e.py` | Ampliat a 41 comprovacions. |
| `docs/ui-2.0/UI2_1_FIDELITAT_PROVES_I_AUDITORIA.md` | Aquest document. |
Sense canvis a `app/index.html` ni a `scripts/build-static.js` respecte de la UI 2.0.

## 3. Què s'ha traslladat del vídeo
- **Pictogrames originals** (mateix traç, gruix i proporció 48×48): document/autorització, targeta de pagament, triangle d'avís, ampolla/material, rellotge, escola/graduació, calendari, ubicació, correu (Gmail), entrada, música, reunió, i a més inici, historial, configuració, estrella, usuari, paleta, paperera, llapis, càmera, compartir i copiar. Van dins de requadres daurats arrodonits de 54 px. **El pictograma correspon al contingut real** de cada targeta (regles de text només visuals, sense reclassificar res).
- **Ja no queden emojis** a Text/Imatge, la navegació, Compartir, Copiar, Configuració, Historial, Premium ni els botons de calendari i Maps.
- **Tasques i prioritats:** capçalera amb pictograma daurat i títol blanc; xips «P1 · Imprescindible», «P2 · Preparació» i «P3 · Informació» amb punt de color i comptador; franja lateral de 7 px (P1 coral `#E5574F`, P2 daurat `#D4A830`, P3 gris blavós `#8C9BB0`); text blanc 17 px en negreta; data amb pictograma de calendari en el color de la prioritat. A la pantalla Tasques la data surt de l'historial; marcar com a feta fa servir el control original de `script.js`.
- **Calendari:** capçalera «CALENDARI»; esdeveniments amb caixa de data (dia gran i mes abreujat), títol blanc i hora daurada a la dreta; fitxes de dades (Lloc, Falten…) com a l'anàlisi de fotos del vídeo; botons «Afegir al calendari» i «Obrir a Google Maps» amb contorn daurat.
- **Terminis ≠ cites:** les dates de les tasques es mostren en una llista separada, «Terminis · dates límit, no són cites», amb caixa de contorn **discontinu** del color de prioritat i etiqueta «TERMINI». A les targetes de tasca la data es presenta com a «Termini: …». No es converteix cap termini en una cita.
- **Resum:** distintiu «✓ Anàlisi completada», capçalera «RESUM» amb estrella, text blanc en negreta i fitxes P1/P2/P3 amb el **recompte real de targetes**.
- **Profunditat cromàtica:** fons blau marí amb degradat vertical i tres reflexos radials estàtics (daurats i blau pissarra), amb matisos per pantalla: Tasques càlid, Premium més daurat, Configuració i Historial més freds. Targetes més clares que el fons, amb llum superior interna i ombra suau. No hi ha cap animació de fons.
- **FREE = mateixa qualitat que PREMIUM:** xip FREE, botó principal i franja Premium amb el mateix acabat que la pàgina Premium.

## 4. Animació corporativa: correccions de l'auditoria de ChatGPT
| Punt | Solució |
|---|---|
| Recuperar l'indicador original si l'animació falla | L'indicador només s'amaga amb `body.ui2-scanning`, que s'activa quan la capa ja està creada. Hi ha `try/catch` a tota la seqüència. Si `ui2.js` no carrega, es veu l'indicador original (provat bloquejant `ui2.js`). |
| Moviment reduït | No es crea cap capa animada; es mostra l'indicador original. Totes les animacions i transicions s'anul·len (provat: cap animació activa). |
| Bloquejos i interaccions accidentals | La capa absorbeix els tocs sobre el contingut amagat, però **no cobreix la navegació inferior**. Navegar durant l'anàlisi retira la capa. Tocar durant el final salta l'animació. El temps mínim baixa a 1,1 s i el final dura ≈1,2 s. |
| Reversibilitat real i completa | `ui2.js` ja no s'autoactiva: només actua si `<body class="ui2">`. Amb `?ui2=off` no s'aplica res. `NexLupaUI2.disable()` restaura en calent l'HTML original de tot el que s'havia modificat, elimina el que s'havia injectat i treu les classes. |
| Recursos | Només els retalls del logotip oficial (`ui2-lupa.png`, `ui2-logo.png`). |

Correcció interna detectada durant les proves: un bucle d'observació (reconstrucció repetida de la llista de terminis) penjava la pàgina. Es va resoldre amb una signatura de contingut abans de publicar.

## 5. Proves
### Automàtiques deterministes (sense serveis externs)
- `npm test`: **261/261** (253 del motor + 8 de la UI).

### Navegador amb dades **simulades** (`python3 tests/e2e/ui2_e2e.py`): 41/41
- A · Missatge escolar: P1/P2/P3 = 2/2/2; comptadors iguals; fitxes del Resum = recompte; etiquetes del vídeo; terminis exactes (4, 10 i 2 de desembre); pictogrames per contingut (document, targeta, avís, rellotge, escola); calendari 18 DES 8:15 h i 22 DES 13:00 h; terminis separats i ordenats (2, 4, 10, 18); cap emoji; cap error de JavaScript; cap desbordament. Pantalla Tasques: 6 targetes, comptadors 2/2/2, termini i data informativa diferenciats; marcar com a feta es desa amb el control original.
- B · Termini vençut i «Fins:» conservats. C · Sense accions. D · Error 500. E · Resposta de 50 ms i navegació durant l'anàlisi. F · Moviment reduït. H · Reversibilitat (`?ui2=off`, `disable()`, fallada de `ui2.js`). G · Responsive a 360×740, 412×915, 768×1024, 1280×860 i 1920×1080 en totes les pàgines. I · Contrast WCAG AA ≥ 4,5:1 (títol 12,35; P1 4,99; P2 6,92; P3 5,81).
- Build de Vercel: correcte.

### Proves **reals**: pendents
- No s'ha executat cap anàlisi contra l'API real (OpenAI) ni cap prova en un mòbil físic. Cal validar a la preview: Chrome Android, Samsung Internet, Edge i escriptori (norma 7 de les regles de desenvolupament).

## 6. Diferències amb el vídeo: funcions que l'app no té (no s'han simulat)
1. **Pantalla «Calendari» independent** amb un sol botó «Afegir al calendari» per a tot: no existeix. El calendari s'integra als resultats, i cada esdeveniment o tasca té el seu botó real.
2. **Paraules destacades en daurat dins del text del Resum** (com al vídeo): el motor retorna text pla. No s'ha marcat res.
3. **«Recordar la data»** (fitxes de l'anàlisi de fotos): no existeix a l'app.
4. **Gmail automàtic, anàlisis il·limitades, recordatoris i PDF setmanal:** continuen sent pantalles conceptuals del vídeo. No s'han afegit.

## 7. Incidències per als equips del motor (no tocades)
- **Exportació de terminis:** el botó «Afegir al calendari» de les targetes de tasca (`_buildCalBtn` / `addActionToCalendar`, a `script.js`) crea un esdeveniment de dia sencer en la data límit. Visualment ara queda marcat com a «Termini», però la lògica d'exportació converteix el termini en una entrada del dia. Cal que ho decideixin l'equip QA96 i ChatGPT.
- **Tasques sense data pròpia:** `_allTasques` no desa la data. La vista la llegeix de l'historial, que guarda com a màxim 30 anàlisis; si l'anàlisi d'origen ja no hi és, la tasca surt sense data.
- **Pantalla Tasques en producció:** les tasques de prioritat baixa tenen un contrast insuficient (ja documentat a la UI 2.0).

## 8. Captures comparatives (vídeo V9f ↔ app real)
Al Drive, `UI2_1_comparativa_*.jpg`: FREE/Inici, anàlisi amb la lupa, convergència i explosió a la X, Resum, Tasques i prioritats, Calendari, PREMIUM 1.0, fitxes de dades, i un full amb totes.

## 9. Com auditar
```bash
git fetch origin ui-2.0 ui-2.0-ref fix/qa96-deterministic-dates-20261112
git diff origin/ui-2.0-ref..origin/ui-2.0 --stat
git diff origin/fix/qa96-deterministic-dates-20261112..origin/ui-2.0 -- api lib app/script.js   # buit
npm test                                   # 261/261
python3 tests/e2e/ui2_e2e.py               # 41/41 (requereix playwright + Chromium)
# Preview: …/app/  ·  comparar amb …/app/?ui2=off
```
