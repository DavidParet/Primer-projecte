# NexLupa — Documentació de Producte

Els prompts i decisions de producte es tracten com a codi.
Cap prompt rellevant es perd. Tot té versió.

---

## Estructura

| Carpeta | Contingut |
|---------|-----------|
| `ai/` | Prompts del motor IA — el cor de NexLupa |
| `ui/` | Prompts de visualització i render de resultats |
| `ux/` | Experiència d'usuari, flows, onboarding |
| `growth/` | Compartir, viralitat, conversió, CTAs |
| `premium/` | Funcionalitats de pagament i upsell |
| `architecture/` | Backend, integracions, API, infraestructura |

---

## Convencions

- Cada fitxer segueix el format: `nexlupa-[àmbit]-[nom]-v[N].txt`
- Per actualitzar: crear `v2`, mai sobreescriure `v1`
- Els prompts actius no porten versió al nom (`nexlupa-core-ai-prompt.txt`)
- `resum_ai_Prompt.txt` recull l'historial de versions del motor IA

---

## Fitxers actius

| Fitxer | Descripció |
|--------|------------|
| `ai/nexlupa-core-ai-prompt.txt` | Prompt actiu del motor IA (v3) |
| `ui/nexlupa-ui-result-render-v1.txt` | Prompt del disseny de resultats (v1) |
