# NEXLUPA — NORMES DE DESENVOLUPAMENT I ESTABILITAT
**Versió:** v1  
**Data:** 2026-05-21  
**Estat:** Normativa oficial

---

## CONTEXT

El canvi de logo ha provocat:

- regressions visuals
- canvis de layout no desitjats
- problemes responsive
- múltiples fixes sobre fixes
- pèrdua de temps
- consum excessiu de tokens
- risc real de destrossar una UI ja funcional

**Conclusió:**  
El problema NO era el logo.  
El problema era el procés de treball.

A partir d'ara NexLupa es tracta com un **PRODUCTE REAL**, no com un sandbox experimental.

---

## PRINCIPI GENERAL

**ESTABILITAT > ITERACIÓ.**

No volem:
- refactors constants
- reinterpretacions visuals
- "millores" automàtiques
- reestructuracions globals

Volem:
- canvis mínims
- controlats
- reversibles
- validats

---

## REGLA 1 — ABANS DE TOCAR RES VISUAL

SEMPRE:

1. commit estable
2. tag estable
3. deploy estable verificat

Exemple:
```bash
git tag stable-mobile-ui-v1
```

O crear branch:
```
stable-production
```

---

## REGLA 2 — MAI TOCAR MAIN DIRECTAMENT

Qualsevol canvi visual o UX:
- branch separat

Exemples:
- `logo-update-safe`
- `dark-mode-fix`
- `landing-v1`
- `navbar-cleanup`

**Mai:** treballar directe sobre `main`.

---

## REGLA 3 — UN OBJECTIU PER CANVI

**PROHIBIT:**  
"ja que toquem el logo aprofitem per…"

Cada tasca té **UN** objectiu.

✅ Exemples correctes:
- substituir SVG logo
- arreglar dark mode Chrome
- ajustar spacing navbar

❌ Exemples incorrectes:
- canvi logo + responsive + navbar + cleanup CSS

---

## REGLA 4 — CLAUDE NO DECIDEIX ARQUITECTURA

Claude tendeix a:
- refactoritzar
- reinterpretar
- reorganitzar
- "millorar" estructura

Això és **PERILLÓS** en producte estable.

Els prompts han d'incloure SEMPRE:
- NO refactoritzar
- NO reinterpretar layout
- NO tocar estructura
- NO reorganitzar responsive
- només canvi mínim necessari

---

## REGLA 5 — SI ES TRENCA ALGUNA COSA

**NO arreglar sobre caos.**

Procediment correcte:
1. **STOP**
2. rollback immediat
3. recuperar últim estat estable
4. validar
5. només llavors continuar

**PROHIBIT:**
- fixes sobre fixes
- múltiples intents consecutius
- tocar 5 coses a la vegada

---

## REGLA 6 — VERCEL ÉS EL PUNT DE SEGURETAT

Abans de qualsevol canvi important:
- identificar deploy estable
- marcar-lo
- guardar commit estable

En cas de problema:
- rollback deploy Vercel
- no debugging infinit

---

## REGLA 7 — VALIDACIÓ OBLIGATÒRIA

Qualsevol canvi visual — comprovar SEMPRE:
- Chrome Android
- Edge
- desktop

Especialment:
- dark/light mode
- responsive mobile
- navbar
- safe areas
- viewport

---

## REGLA 8 — CONGELAR UI ABANS DE VÍDEOS

Abans de captures, demos, vídeos, landing comercial:

La UI ha d'estar:
- congelada
- estable
- validada

**NO fer canvis visuals durant gravacions.**

---

## OBJECTIU ACTUAL

1. estabilitzar UI actual
2. crear punt estable oficial
3. backup deploy estable
4. només llavors:
   - canvi logo segur
   - vídeos
   - landing
   - demos comercials

---

## CONCLUSIÓ

El problema d'avui NO és un fracàs.

És el moment on NexLupa deixa de ser "experiment IA" i passa a ser **PRODUCTE REAL**.

A partir d'ara:  
menys improvisació,  
més control,  
més estabilitat,  
més metodologia.
