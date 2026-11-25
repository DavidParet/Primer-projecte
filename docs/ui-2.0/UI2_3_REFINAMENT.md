# NexLupa · UI 2.3 — Refinament (respirar, menys pes, presentació X + halo)

Branca: `ui-2.0` · Versió de la capa visual: `NexLupaUI2.version = '2.3.0'` · Data: 2026-11-25
Base: UI 2.2 (commit `34a1890`). Motor QA96 sense cap canvi.

## 1. Canvis aplicats

### Transició d'anàlisi
- Una lupa sola i reconeixible (`app/assets/ui2-lupa-sola.png`). Està redibuixada geomètricament amb les mides del logotip oficial: anell, vidre daurat i mànec a 45°. No té cap lletra ni cap forma d'«a». Escaneja el missatge mentre el motor treballa.
- Quan arriba la resposta, la lupa s'esvaeix i apareix la X de la marca (`app/assets/ui2-x.png`, retallada del logotip oficial). Uns deu punts de llum convergeixen al diamant central i la X s'il·lumina.
- La X esclata en llum càlida: un halo radial s'expandeix i s'esvaeix, i un anell fi s'obre.
- El resum entra amb una llum càlida de fons i un lleuger ascens amb brillantor (`#results.ui2-emerge`), enllaçat amb l'esclat.
- La part de la X dura uns 0,96 s. No s'afegeix cap retard artificial quan el motor triga; el mínim d'escaneig és de 0,8 s.
- No hi ha flaixos agressius ni animacions contínues.
- Amb moviment reduït (`prefers-reduced-motion`) no hi ha capa d'animació i es manté el carregador original.
- Ja no es fa servir el logotip sencer amb un flaix petit al centre: `.ui2-logo`, `.ui2-core` i `.ui2-flash` estan amagats.

### Tipografia
| Element | Abans (2.2) | Ara (2.3) |
|---|---|---|
| Text del resum | més gran, en negreta | 15,5 px / 600 |
| Text de targeta | 15–16 px / negreta | 14 px / 500 |
| Dates | negreta | 12,5 px / 500 |
| Títol de l'historial | — | 13,5 px / 500, màxim 2 línies |
| Capçaleres de secció | 18 px | 13,5 px en majúscules espaiades |

La negreta queda només per a l'essencial: el resum, «Termini:», l'hora de l'esdeveniment i les capçaleres.

### Pictogrames i targetes
- Marcs d'icona: 30 px, abans uns 40. Línia d'1 px més suau. Icones a 15–18 px.
- Cercle de tasca completada: punt visible de 20 px, però amb una zona de toc de 40×40 px.
- Targetes amb padding de 8 px i franja lateral de 3 px. El text guanya amplada.
- El botó de calendari de les tasques passa a «Afegir», compacte i a la mateixa línia que la data. L'etiqueta accessible continua sent «Afegir al calendari».
- Historial: files compactes (icona | extracte de 2 línies | fletxa ›). Tota la fila continua obrint el contingut complet.

### Jerarquia del resultat
1. Resum: caixa amb «Anàlisi completada».
2. Comptadors P1/P2/P3 compactes.
3. Calendari: esdeveniments amb caixa de data i hora.
4. Terminis: llista separada, «dates límit, no són cites».
5. Tasques: nova capçalera (`#ui2-tasks-head`) coherent amb «Calendari», abans dels grups P1/P2/P3.

Les seccions es separen amb una línia fina i aire, sense caixes noves. Els xips de prioritat es mantenen petits.

### Capçalera mòbil
- Logotip a 150×75. En fer scroll avall (més de 36 px) es compacta a 96×48 i el lema es plega. La capçalera queda a 57 px.
- Torna a la mida gran quan es torna a dalt.
- Comprovat: el botó final per reiniciar l'anàlisi no queda tapat per la capçalera ni per la barra inferior.

### Colors
Es manté la paleta suavitzada de la 2.2, sense més saturació. Els contorns d'icona són més fluixos i els botons secundaris més petits, de manera que les vores, les icones i el text competeixen menys.

## 2. Comprovacions

| Prova | Resultat | Tipus |
|---|---|---|
| `npm test` (contracte, motor, dates) | 261/261 | Estàtica / unitària |
| E2E `tests/e2e/ui2_e2e.py` (escola, vençut, sense accions, error 500, resposta ràpida + navegació, moviment reduït, `?ui2=off`, `disable()`, responsive, contrast) | 41/41 | Navegador Chrome amb emulació mòbil, dades simulades |
| Amplades 360 / 390 / 412 px: desbordament lateral | Cap | Emulació |
| Controls de menys de 32 px | Cap. S'han corregit el botó Premium de la capçalera (27 px) i el botó de conversa (22 px) | Emulació |
| Resultat llarg (3 esdeveniments + 9 tasques) i 3 entrades d'historial | Correcte, sense contingut amagat | Emulació, dades simulades |
| Botó final visible entre capçalera i barra inferior | OK a les tres amplades | Emulació |
| Diff del motor (`api/`, `lib/`, `app/script.js`, `vercel.json`, `package.json`) contra `fix/qa96-deterministic-dates-20261112` | Buit | Git |
| Construcció estàtica (en una còpia) | 18 recursos copiats, inclosos els nous PNG | Script de build |

### Vídeo de referència
El vídeo V9f definitiu estava disponible en local (`nexlupa_video/V9f_DEFINITIVA/videos/`). La seqüència lupa → X → esclat càlid → resultat s'ha fet seguint-ne l'estètica (daurat càlid, halo radial, diamant central). És una adaptació a la interfície, no una reproducció fotograma a fotograma del vídeo.

## 3. Limitacions pendents
- **Motor real:** totes les proves visuals s'han fet amb respostes simulades de `/api/analyze`. Cal provar-ho a la preview amb el motor real.
- **Mòbil físic:** les amplades s'han comprovat amb emulació de Chrome. Falta provar-ho en un iPhone o Android real, sobretot la suavitat de l'esclat i la compactació de la capçalera amb scroll inercial.
- **Fluïdesa:** la gravació de la transició és d'un navegador sense pantalla. Els temps reals en un mòbil poden variar lleugerament.

## 4. Entregables
- `UI2_3_abans_despres_{360,390,412}.jpg`: mateixes dades i amplada, 2.2 i 2.3.
- `UI2_3_historial_{360,390,412}.jpg`
- `UI2_3_transicio_390.mp4`: gravació de la transició completa.

## 5. Reversibilitat
- `?ui2=off` o `NexLupaUI2.disable()` desactiven la capa visual sencera i restauren el DOM original, incloses les etiquetes accessibles afegides.
- `ui2-lupa.png` i `ui2-logo.png` (2.2) s'han tret del build, però es conserven a l'historial de git.
