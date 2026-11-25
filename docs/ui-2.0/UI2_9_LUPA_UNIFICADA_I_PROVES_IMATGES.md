# NexLupa UI 2.9 · Lupa unificada i correccions de les proves reals d'imatges

Data: 25/11/2026 · Branca `ui-2.0` (preview privada). Main i producció sense canvis.

## 1. Lupa i marca

- **Original únic:** `NEXLUPA/MARCA/LUPA/nexlupa-lupa.svg`, també a `app/assets/`. És la «a» final del logotip aprovat sense el pal. Coincideix amb el logotip en un 96,9 % del blanc i un 98,9 % del daurat.
- **Monocroma:** `nexlupa-lupa-mono.svg`. Té la mateixa geometria i pren el color del text. Només es fa servir a icones petites.
- **On s'ha aplicat:**

| Lloc | Abans | Ara |
|---|---|---|
| App · pantalla d'espera | `ui2-lupa-sola.png` (dibuixada a mà) | `nexlupa-lupa.svg` blanc i daurat |
| App · icones de línia | lupa de traç fi | geometria unificada, monocroma |
| App · benvinguda, Config, Premium, botó antic | emoji 🔍 | lupa unificada |
| Web · secció de passos (`/` i `/landing/`) | emoji 🔍 | lupa unificada |
| Web · capçalera | logotip reconstruït amb text | fitxer del logotip original (`nexlupa-logo-web.png`: el mateix `logo-white.png`, retallat i reduït), mida visual equivalent |
| Vídeo · escena d'anàlisi | `logo_lupa.png` (semblava una «a») | lupa unificada |
| Vídeo · FREE, Premium, Gmail i fotos | lupes de traç | lupa unificada (blanc i daurat a la marca, monocroma a les icones) |

- **Logotip neXlupa:** no s'ha modificat.
- **Animació aprovada:** es conserva igual: lupa quieta, llum interior i punt de llum, X amb implosió i resum amb halo. Només s'han recentrat la llum i el punt al disc daurat (38,03 % / 39,07 %).
- **Arxiu:** `NEXLUPA/MARCA/LUPA/ARXIU_NO_REUTILITZAR/` conté el prototip visual antic i la lupa de la UI 2.0–2.8. Estan marcats com a no vigents.

## 2. Proves reals d'imatges: causa i correcció

**Causa principal: la fase d'extracció.** Amb imatge, el model llegia i interpretava alhora, i el servidor no rebia el text llegit. Sense aquest text, la normalització no tenia res amb què comprovar dates, llocs, adreces ni imports, i acceptava la interpretació tal com venia.

**Correcció general:** l'anàlisi d'una imatge es fa ara en dos passos:
1. Primer es llegeix literalment el text de la imatge. La capçalera del xat, el remitent i l'hora d'enviament es guarden a part.
2. Després aquest text s'analitza exactament igual que un missatge escrit.

Això activa totes les comprovacions del text i, a més, aquestes regles noves:

- **Sortida, tornada i destinació** es llegeixen del missatge i es mostren per separat. Si una frase del model presenta l'hora de sortida com l'inici de la visita, es substitueix per la frase original.
- **Tornada aproximada:** «cap a les 16:30» no es converteix mai en una hora exacta.
- **Adreça literal:** carrer, número i població, només quan consten al missatge. Maps busca aquesta adreça escrita, sense coordenades. Es manté el nom del lloc («Pati de l'escola»). No s'inventa cap adreça: l'escola de la captura no en té cap.
- **Imports amb el seu concepte:** cada import es mostra amb el concepte que l'acompanya («Xocolatada solidària: 2 €»). Si una frase del model associa l'import a un altre concepte (entrada, taller…), es torna a la frase original.
- **«abans del» i «fins al»:** es respecta la preposició del missatge a tasques, resum, calendari i text de compartir. El termini es mostra tal com el diu el missatge.
- **Lectura del resultat:**
  - «Terminis» fa una referència breu amb la data i un enllaç a la tasca completa, que continua a «Tasques».
  - L'avís que les dades s'han llegit d'una imatge és ara una nota discreta al final, no una dada útil.

## 3. Resultats amb el motor real (preview, imatges originals, referència 25/11/2026)

Les dues anàlisis es van repetir a la preview amb les imatges originals i el motor real.

| Comprovació | Captura de la sortida | Cartell de Nadal |
|---|---|---|
| Text llegit de la imatge | complet i literal | complet i literal |
| Acte | Sortida al Museu Marítim, 9/12, sortida de l'escola 8:45, tornada cap a les 16:30, destinació Museu Marítim | Festa de Nadal, 19/12, 10:00–13:00, Pati de l'escola |
| Adreça | cap (no s'inventa) | C/ dels Pins, 12, Sant Cugat (Maps amb aquesta adreça) |
| Imports | El preu és de 14 € | Xocolatada solidària: 2 € |
| Terminis | pagament abans del 3/12; autorització abans del 4/12 | inscripció al taller fins al 15/12 inclòs, ampa@elspins.cat |
| Preparació | esmorzar, dinar i aigua | — |

**Errors trobats amb el motor real i ja corregits en aquesta versió:**
- El model guardava «abans del 4» com el dia 3. Ara la targeta mostra la data i el tipus de termini que diu el missatge.
- El resum deia «tornada a les 16:30». Ara diu «cap a les 16:30».

**Consum per anàlisi d'imatge:** aproximadament 1.000–1.450 tokens per llegir la imatge i 3.800–4.000 per analitzar-ne el text (una part ja estava a la memòria cau). Temps: 4–6 s.

**Text (FREE):** continua funcionant pel mateix recorregut d'abans i amb una sola crida al model. Una imatge enviada sense accés Premium continua rebent un 403 abans de cridar la IA.

## 4. Validació

- `npm test`: 288/288. Inclou proves de regressió amb les respostes reals del model.
- E2E: 83/83. Hi ha 40 comprovacions noves amb les dues imatges a 390, 360 i 390 px amb el text ampliat al 130 %: sense desbordament, nota final, terminis, adreça i Maps.
- Lupa a mida petita (18 px) i amb el text ampliat: es llegeix bé. Captures: `captures_2_9/`.

## 5. Enllaços de proves

- **FREE:** `…/app/#mode=free`
- **Premium de proves:** `…/app/#mode=premium`
- **Seguretat:** la preview de `ui-2.0` és privada perquè Vercel protegeix tots els desplegaments excepte els dominis propis. El servidor només accepta el mode Premium de proves en aquesta preview. A producció i a qualsevol altra branca, sempre es denega. No hi ha cap clau al navegador ni al repositori. Per entrar-hi des de fora del compte de Vercel cal un enllaç d'accés temporal (23 h).

## 6. Vídeo

**V9h (lupa unificada):** s'ha corregit sobre els màsters V9f amb el mateix mètode de pegat. Els originals es conserven.

- **Lupa:** s'ha substituït a l'escena d'anàlisi i a les escenes FREE, Premium, Gmail i fotos.
- **«Recordar la data»:** s'ha tret, perquè l'escena ja té el botó «Afegir al calendari» (l'acció manual que existeix) i duplicar-lo hauria estat confús. «Obrir a Google Maps» ocupa ara tota l'amplada.
- **Fitxers:** 96 s amb rètols, 96 s màster sense rètols, 84 s variant curta i tram Premium 360p.
