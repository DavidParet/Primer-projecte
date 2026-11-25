# NexLupa UI 2.2 — Refinament visual (no redisseny)

**Branca:** `ui-2.0` · **Base:** UI 2.1 (`2253f03`) · **Motor QA96, lògica, integracions, `main` i producció:** sense canvis.
Tots els canvis són al bloc «UI 2.2» al final de `app/ui2.css`. A `app/ui2.js` només canvia el número de versió.

## Canvis
1. **P1 / P2 / P3 com a xips lleugers:** alçada i padding reduïts (2 px × 10 px), contorn d'1 px translúcid, text de 12 px, punt de 6 px i comptador discret (número en color sobre fons translúcid). Les fitxes del Resum passen de targetes grosses a una fila compacta de xips («● 2 P1 · ● 2 P2 · ● 2 P3»).
2. **Paleta menys saturada, amb la mateixa identitat:**

   | Element | UI 2.1 | UI 2.2 |
   |---|---|---|
   | Daurat principal | `#F5C518` | `#E9C14A` |
   | P1 coral | `#E5574F` | `#C96A63` |
   | P2 daurat | `#D4A830` | `#C4A453` |
   | P3 gris blavós | `#8C9BB0` | `#8593A6` |
   | Verd | `#6EE7B7` | `#8FCBB2` |

   Els contorns es redueixen de 2 px a 1,5 px i guanyen transparència; els botons daurats tenen menys brillantor i ombra.
3. **Ergonomia:**
   - Les targetes de tasca perden alçada: padding de 10 px, franja de 4 px, pictograma de 42 px, títol de 15,5 px i data de 13 px.
   - El Resum i les capçaleres són més compactes.
   - La pantalla Tasques, l'Historial i els terminis també ocupen menys.
   - Es veu més informació sense haver de desplaçar la pantalla.
4. **Halos ambientals (estàtics):** llum càlida i difusa darrere del contingut, a la mateixa alçada que al vídeo, més reflexos laterals suaus. Halo discret al Resum, a l'hero de Premium, a la franja Premium i a les targetes d'esdeveniment. Sense animacions i sense cost de rendiment.
5. **Es conserva:** el calendari (caixa de data i hora, i les mides de 2.1), els pictogrames, la separació entre terminis i esdeveniments, i la base visual.

## Proves (dades simulades)
- `npm test`: 261/261.
- `tests/e2e/ui2_e2e.py`: 41/41. Contrast WCAG AA: P1 5,48 · P2 6,68 · P3 5,88 · títols 12,35.
- Proves reals (API i mòbil físic): pendents.
