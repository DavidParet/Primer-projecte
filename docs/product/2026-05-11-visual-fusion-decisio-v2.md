# NexLupa — Visual Fusion DECISIÓ v2
Data: 2026-05-11  
Sessió: claude/enhance-decision-concept-96FFG  
Deploy: app.nexlupa.app (Vercel auto-deploy from main)

---

## Context

Après el desplegament de v10 (Round 1: dates, perspectiva, header, tagline, iconografia), les proves visuals mostraven:

- Fons "terminal dark" massa pla (#111 sòlid sense profunditat)
- Jerarquia DECISIÓ debilitada vs versions anteriors
- Colors de prioritat poc llegibles (vermell/groc poc contrast)
- Sensació d'interfície genèrica en lloc de motor intel·ligent premium

**Directriu clara:** NO redissenyar. Recuperar la màgia visual i potenciar els punts forts existents. Retocs quirúrgics de CSS.

---

## Canvis aplicats (app/style.css v10)

### 1. Contenidor de resultats — profunditat
```css
.results.on {
  background: linear-gradient(170deg, #161616 0%, #111 55%);
  box-shadow: 0 0 0 1px rgba(255,255,255,.05), 0 4px 30px rgba(0,0,0,.45);
  position: relative;
  overflow: hidden;
}
.results.on::before {
  content: '';
  position: absolute; top: -30px; left: 50%; transform: translateX(-50%);
  width: 220px; height: 70px;
  background: radial-gradient(ellipse, rgba(245,180,0,.07) 0%, transparent 70%);
}
```
— Gradient subtil + ring shadow exterior + glow daurat ambient a la part superior.

### 2. Bloc DECISIÓ — jerarquia dominant
```css
.nx-decisio-label::before {
  content: '';
  width: 18px; height: 2px;
  background: #f5b400;
  box-shadow: 0 0 8px rgba(245,180,0,.7);
}
.nx-decisio-text {
  font-size: 24px; font-weight: 900;
  color: #ffffff; line-height: 1.18; letter-spacing: -0.03em;
  text-shadow: 0 2px 20px rgba(255,255,255,.08);
}
```
— Línia dorada amb glow + títol 24px 900 weight.

### 3. Cards d'acció — profunditat i contrast
```css
.nx-action-card {
  background: linear-gradient(135deg, #202020 0%, #1a1a1a 100%);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,.3);
}
.nx-prior-alta {
  border-left: 3px solid #ef4444;
  background: linear-gradient(135deg, rgba(239,68,68,.09) 0%, rgba(26,26,26,.0) 60%) !important;
}
.nx-prior-mitja {
  border-left: 3px solid #f5b400;
  background: linear-gradient(135deg, rgba(245,180,0,.07) 0%, rgba(26,26,26,.0) 60%) !important;
}
.nx-prior-pill-alta { background: rgba(239,68,68,.22); color: #ff7070; border: 1px solid rgba(239,68,68,.3); }
.nx-prior-pill-mitja { background: rgba(245,180,0,.18); color: #f5c000; border: 1px solid rgba(245,180,0,.3); }
.nx-action-date { color: #777; }
```
— Gradient lateral per prioritat + pill colors millorats + dates més llegibles.

---

## Fitxers modificats

| Fitxer | Canvi | Versió |
|--------|-------|--------|
| `app/style.css` | Visual fusion — profunditat, DECISIÓ, prioritats | v10 |
| `app/index.html` | (sense canvis nous en Round 2) | v10 |

---

## Principis de disseny consolidats

1. **DECISIÓ és l'element emocional central** — jerarquia visual màxima, sempre.
2. **Colors de prioritat = escaneig instantani** — vermell/groc amb contrast suficient.
3. **Profunditat > Pla** — gradients subtils i shadows per crear sensació de capes.
4. **Premium, no minimalista** — dark UI amb glow, no "terminal".
5. **NO redesenyar** — qualsevol canvi ha de preservar el que ja funciona.

---

## Validació

- [x] DECISIÓ label: línia dorada + glow visible
- [x] DECISIÓ text: 24px, blanc pur, prominent
- [x] Cards alta: tint vermell lateral
- [x] Cards mitja: tint daurat lateral
- [x] Pill alta: vermell llegible (#ff7070)
- [x] Pill mitja: groc llegible (#f5c000)
- [x] Resultat contenidor: gradient subtil + glow ambiental
- [x] Toggle rebut/enviat: conservat
- [x] Header dark blur: conservat
- [x] Context block IA: conservat

---

## Directriu de procés (OBLIGATORI per sessions futures)

1. Desplegar canvis → `git push origin main` o `mcp__github__push_files`
2. Verificar desplegament (Vercel auto-deploy des de main)
3. Confirmar a l'usuari: "Canvis desplegats a app.nexlupa.app ✓"
4. Validar no regressions visuals i funcionals
5. Arxivar sessió en `/docs/product/YYYY-MM-DD-descripcio-vX.md`
