# NexLupa · UI 2.5 — Pantalla d'anàlisi i retocs

Branca: `ui-2.0` · `NexLupaUI2.version = '2.5.0'` · Data: 2026-11-25 · Main i producció sense canvis.

## 1. Pantalla d'anàlisi
- En prémer «Analitzar», el formulari i el missatge deixen de ser visibles. El fons és negre amb un matís blau nit.
- Al centre hi ha la lupa sola (92 px), quieta. Dins el vidre, una llum daurada puja i baixa lentament (cicle de 2,6 s, sense flaixos).
- A sota, «Llegint el teu missatge…»: 13 px, pes normal, blanc trencat. Entra amb opacitat i es queda quiet. No es mostra el missatge original.
- La pantalla dura el que triga el motor. Només hi ha un mínim de 0,5 s per evitar un parpelleig.
- Quan arriba la resposta: la lupa i el text es dissolen (0,28 s), apareix la X i es reprodueix l'efecte d'il·luminació i implosió sense canvis. El resum entra amb la llum càlida.
- El resum conserva un halo subtil permanent.
- **Moviment reduït:** la lupa i el text queden estàtics i es passa directament al resultat, sense pulsació ni implosió.
- **Error:** se surt de la pantalla d'espera i es mostra l'error amb un botó «Tornar-ho a provar». El missatge introduït es conserva.

## 2. Halo
- Llum ambiental daurada estàtica i coherent a Inici, Tasques i Historial, del mateix ordre que la de Premium.
- Resum: contorn daurat amb una resplendor difusa perceptible, permanent.
- No s'ha posat halo a cada fila ni s'ha augmentat la saturació.

## 3. Free vs Premium
- Les funcions no incloses mostren «✕ No inclòs al Free» en un vermell clar (#F08C86), visible sense ser d'alarma.
- «Amb el FREE, 3 anàlisis al dia» passa a ser una dada neutra, sense creu.
- No s'han tocat preus, límits ni funcionalitats.

## 4. Enganxada del scroll — causa comprovada (navegador)
**Causa:** la capçalera es compactava o s'ampliava segons la posició del scroll, amb una animació de 0,25 s. En canviar-ne l'alçada, canviava també l'alçada del contenidor que fa scroll, i el contingut es movia sota el dit.

Mesura feta a la 2.4 amb un recorregut d'anada i tornada prop de dalt:
- l'alçada de la capçalera passava per valors entre 57 i 111 px;
- el contingut saltava fins a 42 px en sentit contrari al gest.

**Correcció:**
- La capçalera es compacta segons l'estat (resultat visible o pantalla diferent d'Inici), mai segons el scroll.
- S'ha tret l'animació d'alçada.
- S'ha afegit `overscroll-behavior: contain` als contenidors amb scroll, perquè no s'encadenin.

**Després de la correcció**, al mateix recorregut: alçada constant de 57 px i cap salt, a 360, 390 i 412 px.

Les altres hipòtesis:
- **Capes de la transició:** descartada. La capa s'elimina en acabar.
- **Desplaçament automàtic:** descartada. Només es fa un `scrollIntoView` instantani en pintar el resultat, abans que l'usuari toqui la pantalla.

## 5. Tasques completades
- La fila ja no té opacitat 0,5.
- El ✓ daurat queda ple i el text a 72 % de blanc, ratllat.
- La zona tàctil continua sent de 40×40 px.

## 6. Resum i terminis (cas Gavà)
- **Presentació (corregit a la UI):** abans, qualsevol tasca amb data sortia a «Terminis» i amb el prefix «Termini:». Per això «portar el material», amb la data de l'activitat, apareixia com a termini.
- Ara només són terminis les tasques amb una data límit real: inscriure's, pagar, confirmar, signar, avisar, entregar, «abans de…», etc. Preparar o portar material queda com a tasca, amb la data sense «Termini:».
- **Contingut del resum (motor):** no s'ha modificat. No s'ha rebut la captura ni el missatge complet de Gavà, i no es pot contrastar si el resum que només enumera el material ve del model.

## 7. Proves
| Prova | Resultat | Tipus |
|---|---|---|
| `npm test` | 265/265 | Unitàries / motor |
| E2E `tests/e2e/ui2_e2e.py` | 43/43, amb noves comprovacions de la pantalla d'espera, el reintent d'error, el moviment reduït estàtic i els terminis reals | Navegador amb emulació mòbil, dades simulades |
| Scroll lent i ràpid amb canvis de direcció prop de dalt (23 passos) | 0 salts, capçalera constant | Emulació |
| Desbordament lateral a 360/390/412 px | Cap | Emulació |

## Pendent al mòbil físic
- Fluïdesa real de l'scroll amb el dit (emulada, no validada físicament).
- Suavitat de la pulsació del vidre i de la implosió.
- Contrast del vermell i de les completades amb la brillantor real de la pantalla.
- Amb el text ampliat del sistema.
