# Decisió estratègica: Agenda Intel·ligent — MainEvent + Contingut

**Data:** 2026-06-13  
**Estat:** Implementada  
**Branca:** `claude/nexlupa-event-priority-motor-bemdti`

---

## Resum executiu

NexLupa passa de ser un **motor de resum** a ser una **agenda intel·ligent**. L'acte principal es separa completament de les accions i es mostra com a targeta dominant amb tota la informació rellevant. El contingut de l'acte (activitats, regal, edat) s'estructura en un nou bloc visual "QUÈ HI TROBARÀS".

---

## Problema detectat

### Bug conceptual: l'Esdeveniment Principal tenia badge de prioritat

El motor anterior tractava l'acte principal (festival, excursió, jornada) com una **acció de calendari** amb prioritat "Mitja". Això era incorrecte en dos nivells:

1. **Conceptual**: Un festival no és una "acció" que l'usuari ha de fer. És el context de totes les accions.
2. **Visual**: La targeta mostrava "MITJA" — un badge de prioritat que no té cap sentit per a un acte cultural o esportiu.

### Exemple del bug (captura real d'usuari):
```
❌ RESULTAT ANTERIOR:
Assistir a la III Festa del Bàsquet Escolar   [MITJA]
Divendres 7 juny · 10:00
📍 Pavelló Can Tintorer de Gavà
[Afegir al calendari]
```

### Informació completament absent:
- Música, Jocs, Tornejos 3x3, Moltes sorpreses ❌
- Samarreta de regal ❌  
- Edat recomanada: 6 a 12 anys ❌
- Places limitades ❌

---

## Solució implementada

### Arquitectura del JSON (v3)

```json
{
  "resum": "...",
  "decisio": "...",
  "mainEvent": {
    "title": "III Festa del Bàsquet Escolar",
    "data": "2026-06-07 10:00",
    "lloc": "Pavelló Can Tintorer de Gavà",
    "edat": "6 a 12 anys"
  },
  "contingut": {
    "items": ["Música", "Jocs", "Tornejos 3x3", "Moltes sorpreses", "Samarreta de regal"],
    "edat": "6 a 12 anys",
    "places": "Places limitades",
    "organitzador": null,
    "cost": null
  },
  "accions": [
    { "accio": "Inscriure's...", "tipus": "tasca", "prioritat": "alta" }
  ]
}
```

### Jerarquia visual resultant

```
📌 ESDEVENIMENT PRINCIPAL
┌─────────────────────────────────────────┐
│  III Festa del Bàsquet Escolar          │
│  📅 Divendres 7 de juny  🕒 10:00h     │
│  📍 Pavelló Can Tintorer de Gavà        │
│  👥 6 a 12 anys   ⏳ X dies             │
│  [📅 Afegir al calendari] [🗺️ Maps]    │
└─────────────────────────────────────────┘

🎉 QUÈ HI TROBARÀS
• Música
• Jocs
• Tornejos 3x3
• Moltes sorpreses
• Samarreta de regal
⚠️ Places limitades

⚡ P1 — Accions imprescindibles
[si n'hi ha]

📋 P2 — Preparació
[si n'hi ha]

ℹ️ Informació addicional
[si n'hi ha]
```

---

## Canvis tècnics implementats

### AI Prompt (`docs/ai/nexlupa-core-ai-prompt.txt`)
- Afegit camp `mainEvent` a l'esquema de sortida
- Afegit camp `contingut` a l'esquema de sortida
- `accions[]` ja NO pot contenir `tipus: 'calendari'` per a l'acte principal
- Regla 25: extracció de `mainEvent`
- Regla 26: extracció de `contingut`
- Actualitzats els exemples del festival i el torneig

### Frontend JS (`app/script.js`)
- `categorizeAccions()`: eliminada la categoria `events`; `calendari` es filtra fora de P1/P2/info
- `splitDateTime()`: separa data i hora per a chips independents
- `calcDiesRestants()`: compte enrere en dies des d'avui
- `buildEventCard(mainEvent)`: targeta dominant amb tots els chips i dos botons
- `renderContingut(contingut)`: nou bloc "QUÈ HI TROBARÀS"
- `renderResult()`: fallback automàtic si la IA retorna `tipus: 'calendari'` en lloc de `mainEvent`

### HTML (`app/index.html`)
- Nou bloc `#nx-what-block` amb `#nx-what-content`

### CSS (`app/style.css`)
- `.nx-chip-days`: chip verd per al compte enrere
- `.nx-chip-lloc`: chip de localització
- `.nx-event-btn-row`: fila de botons de la targeta
- `.nx-event-btn-cal` / `.nx-event-btn-maps`: estils dels botons
- `.nx-what-block`, `.nx-what-list`, `.nx-what-item`: bloc de contingut violeta
- `.nx-what-details`, `.nx-what-detail-chip`: chips de detalls

---

## Principis de producte establerts

1. **L'Esdeveniment Principal és context, no acció.** Mai porta badge de prioritat.
2. **NexLupa és una agenda, no un resum.** L'usuari no ha de tornar a obrir el WhatsApp.
3. **Tot el contingut útil ha de ser visible.** Activitats, regal, edat, places — res pot quedar amagat.
4. **Backward compatibility.** Si la IA antiga retorna `tipus: 'calendari'`, el frontend el converteix automàticament sense trencar res.
5. **Compte enrere en dies.** Calculat en temps real al frontend, no per la IA.
