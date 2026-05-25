# Header Premium Compact v2 — nexlupa.app

## Objectiu
Capçalera molt més compacta i premium, mobile-first. Aspecte d'app IA moderna.

## Descobriment clau
El PNG del logo (`logo-white.png`, 7392×3696 RGBA) té un **37.6% de padding transparent superior i 37.8% inferior**. El contingut visible (text + icona) ocupa només el **24.6% de l'alçada** del canvas.

Conseqüència: a CSS `height: 90px`, el logo visible és ~22px. La resta (68px) és espai transparent que inflava el header.

## Solució: `overflow: hidden` al wrapper

```html
<div class="logo-clip">
  <canvas class="nexlupa-logo" width="360" height="180" ...></canvas>
</div>
```

```css
.logo-clip    { height: 65px; overflow: hidden; flex-shrink: 0; }
.nexlupa-logo { height: 100px; width: 200px; display: block; margin-top: -17px; }
```

El canvas (+11% respecte 90px) es desplaça -17px per centrar el contingut visible dins el wrapper de 65px.

## Canvis implementats

| Element | Abans | Després |
|---|---|---|
| Header padding (desktop) | `14px 20px` | `6px 18px` |
| Header padding (mobile) | `5px 16px` | `3px 14px` |
| Logo canvas CSS | `90×180px` | `100×200px` (+11%) |
| Logo clip wrapper | — | `height: 65px; overflow:hidden` |
| Canvas margin-top | `0` | `-17px` (centra contingut) |
| Alçada header mobile | ~100px | ~71px (−29%) |
| Alçada header desktop | ~118px | ~77px (−35%) |
| Logo visible | ~22px | ~25px (+12%) |
| Botó Premium | `4px 9px / 10px` | `3px 8px / 9px / r-16px` |
| App-col-right padding-top | `2px` | `0` |
| Card padding-top (mobile) | `4px` | `2px` |

## Verificació
- Chrome: header compacte, logo centrat, botó premium refinat
- Samsung Internet: canvas bypass del dark mode intacte (no s'ha tocat el JS)

## Fitxers modificats
- `app/index.html` — wrapper `.logo-clip`
- `app/style.css` — logo, header, botó, spacing
