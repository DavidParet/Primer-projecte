# NexLupa — Fix: Consistència Prioritats Cross-Browser
Data: 2026-05-11  
Sessió: claude/enhance-decision-concept-96FFG  
Deploy: app.nexlupa.app (Vercel auto-deploy from main)

---

## Problema

Chrome mostrava: 1 tasca ALTA + 1 tasca MITJA  
Edge/Explorer mostrava: 2 tasques MITJA (sense cap ALTA)

---

## Causa arrel

Dues fonts d'inconsistència identificades a `app/script.js`:

### 1. Funció `isWithin24h` — dependent del temps del sistema
La funció comparava la data de la tasca amb `new Date()` en temps real:
```javascript
var diff = dt - new Date();
return diff >= 0 && diff <= 86400000; /* 24h en ms */
```
Si Chrome i Edge s'executaven en moments o màquines/timezones diferents, una tasca MITJA podia pujar a ALTA en un navegador però no en l'altre. **Resultat directe: MITJA → ALTA en Chrome però MITJA en Edge.**

### 2. `prioritat` sense normalització de majúscules
El camp `prioritat` de la resposta de l'API s'assignava directament sense `.toLowerCase()`:
```javascript
prioritat: a.prioritat || 'baixa'
```
Si la IA retornava `'Alta'` en lloc de `'alta'`, la comparació estricta `a.prioritat === 'alta'` fallava silenciosament, fent que `aiAltaIdx = -1` i canviant el comportament heurístic de forma impredictible.

---

## Canvis aplicats (app/script.js v12)

### Eliminat: funció `isWithin24h` i segona passada temporal
```javascript
// ELIMINAT COMPLETAMENT:
function isWithin24h(dateStr) { ... }

/* Segona passada: regla temporal — hora concreta dins 24h → +1 nivell */
var altaCount = result.filter(...).length;
result = result.map(function (a) {
  if (!isWithin24h(a.data)) return a;
  ...
});
```

### Afegit: normalització de `prioritat` a minúscules
```javascript
// ABANS:
prioritat: a.prioritat || 'baixa'

// DESPRÉS:
prioritat: (a.prioritat || 'baixa').toLowerCase()
```

---

## Fitxers modificats

| Fitxer | Canvi | Versió |
|--------|-------|--------|
| `app/script.js` | Eliminar `isWithin24h` + normalitzar prioritat | v12 |
| `app/index.html` | Cache bust `?v=11` → `?v=12` | v12 |

---

## Principi aplicat

**Determinisme absolut**: el càlcul de prioritats ha de produir el mateix resultat independentment de:
- El moment en que s'executa
- El navegador / motor JS
- El sistema operatiu / timezone

La lògica heurística de prioritats ara depèn únicament del contingut del text de les accions i del camp `prioritat` retornat per la IA — res de temps real.

---

## Validació post-deploy

- [ ] Chrome: 1 ALTA + 1 MITJA (o el que correspongui al contingut)
- [ ] Edge: idèntic a Chrome
- [ ] Disseny, colors, UI: sense cap canvi visible
- [ ] Toggle, DECISIÓ, header: conservats
