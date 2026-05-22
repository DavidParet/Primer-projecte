# NEXLUPA — WORKFLOW CANVI LOGO SEGUR
**Versió:** v1  
**Data:** 2026-05-21  
**Estat:** Actiu

---

## PUNT ESTABLE ACTUAL

| Element | Valor |
|---|---|
| Commit estable | `bd61feb` |
| Tag | `stable-mobile-ui-v1` |
| Branch de treball | `logo-update-v1` |
| Branch protegit | `main` (NO tocar) |
| Deploy Vercel | `main` → app.nexlupa.app |

---

## COM TREBALLAR EL LOGO

### 1. Sempre treballar a `logo-update-v1`

```bash
git checkout logo-update-v1
```

**MAI fer canvis de logo directament a `main`.**

### 2. Canvis mínims i únics

Cada commit ha de tenir UN sol objectiu:
- ✅ "substituir logo SVG per PNG"
- ✅ "ajustar mida logo header"
- ❌ "canvi logo + responsive + cleanup CSS"

### 3. Validar abans de continuar

Cada canvi visual comprovar:
- [ ] Chrome Android
- [ ] Edge mòbil
- [ ] Desktop
- [ ] Dark mode
- [ ] Light mode

### 4. Merge a main NOMÉS si tot validat

```bash
git checkout main
git merge logo-update-v1
git push origin main
```

---

## COM FER ROLLBACK SI ES TRENCA

### Opció A — Rollback del branch
```bash
git checkout logo-update-v1
git reset --hard stable-mobile-ui-v1
git push -f origin logo-update-v1
```

### Opció B — Recuperar main estable
```bash
git checkout main
git reset --hard stable-mobile-ui-v1
git push -f origin main
```

### Opció C — Vercel (des del dashboard)
- Deployments → buscar deploy de `bd61feb` → Redeploy / Promote to Production

---

## REGLES ESPECÍFIQUES PER AL LOGO

1. **NO tocar** `app/style.css` fora de les regles de logo
2. **NO tocar** `app/index.html` fora de l'element logo
3. **NO tocar** `app/script.js`
4. **NO tocar** layout, responsive, navbar, spacing
5. El canvi ha de ser **invisible** a tot excepte el logo

---

## ESTAT VERIFICAT

Layout mòbil estable confirmat a:
- bottom-nav visible i funcional
- textarea visible al mòbil
- headline "Enganxa el missatge. La resta ho fa nexlupa."
- badges Tasques / Historial funcionant
- Chrome Android ✓
- Edge ✓
