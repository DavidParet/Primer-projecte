# Agenda Intel·ligent — Contingut i MainEvent

**Data:** 2026-06-13  
**Repositori de prompts estratègics de NexLupa**

---

## Objectiu de la millora

NexLupa ha de convertir un missatge en una **agenda intel·ligent completa**, no en un resum. L'usuari no ha de necessitar tornar a obrir el WhatsApp original.

Per a cada esdeveniment, l'app ha d'extreure i estructurar:
- Nom de l'acte (Esdeveniment Principal)
- Data, hora, ubicació, edat recomanada
- Compte enrere de dies restants
- Activitats i contingut de l'acte (QUÈ HI TROBARÀS)
- Accions imprescindibles (P1)
- Preparació (P2)
- Informació addicional

---

## Prompt complet

Actua com un enginyer sènior de producte i frontend.

### OBJECTIU

NexLupa no ha de resumir. Ha de convertir un missatge en una agenda intel·ligent.

Per a cada esdeveniment, extreu:
- Nom de l'acte principal
- Data, hora, lloc, edat recomanada
- Contingut de l'acte (música, jocs, tornejos, sorpreses, samarreta de regal...)
- Places limitades, organitzador, cost si existeix
- Data límit d'inscripció (com a acció P1)
- Queden X dies (calculat al frontend)

### NOVA ESTRUCTURA

#### MAINVENT — Camp independent al JSON de la IA
```json
"mainEvent": {
  "title": "III Festa del Bàsquet Escolar",
  "data": "2026-06-07 10:00",
  "lloc": "Pavelló Can Tintorer de Gavà",
  "edat": "6 a 12 anys"
}
```

L'Esdeveniment Principal NO és una acció. No entra a `accions[]`. No té badge de prioritat.

#### CONTINGUT — Bloc "QUÈ HI TROBARÀS"
```json
"contingut": {
  "items": ["Música", "Jocs", "Tornejos 3x3", "Moltes sorpreses", "Samarreta de regal"],
  "edat": "6 a 12 anys",
  "places": "Places limitades",
  "organitzador": null,
  "cost": null
}
```

#### ACCIONS — Només P1 i P2 (sense calendari)
```json
"accions": [
  { "accio": "Inscriure's...", "tipus": "tasca", "prioritat": "alta" },
  { "accio": "Portar...", "tipus": "tasca", "prioritat": "mitja" }
]
```

### INTERFÍCIE

**Targeta UDÁLOST PRINCIPAL:**
- Nom gran en Syne 800
- Chips: 📅 Data | 🕒 Hora | 📍 Lloc | 👥 Edat | ⏳ X dies
- Botons: `📅 Afegir al calendari` + `🗺️ Obrir Maps`

**Bloc QUÈ HI TROBARÀS:**
- Llista amb punts violetes
- Chips de detalls (places, cost, organitzador)
- Color violeta (#a78bfa)

---

## Justificació funcional

L'error conceptual anterior era tractar l'Esdeveniment Principal com una "acció de calendari" amb prioritat "Mitja". Això provocava que l'acte central aparegués com una targeta ordinària amb badge "MITJA".

**Exemples del bug:**
- "Assistir a la III Festa del Bàsquet Escolar — MITJA" ❌
- "Festival de fi de curs — CALENDARI, MITJA" ❌

**Solució:**
- L'Esdeveniment Principal és el **context** del missatge
- P1/P2 són les **accions** que deriven d'aquest context
- La jerarquia visual ha de reflectir la jerarquia conceptual

Igualment, la primera versió no extreia res del contingut ric del missatge (activitats, regal, places, edat). Una família que analitzi "III Festa del Bàsquet Escolar" necessita saber que:
- Hi haurà música, jocs, tornejos 3x3
- Tots els participants reben una samarreta de regal
- L'edat recomanada és de 6 a 12 anys
- Les places són limitades

Sense aquesta informació, NexLupa era un motor de resum, no una agenda intel·ligent.

---

## Decisió de producte adoptada

**Decisió 1:** `mainEvent` com a camp de primer nivell al JSON de la IA, independent de `accions`.

**Decisió 2:** `contingut` com a camp de primer nivell amb activitats, edat, places, organitzador i cost.

**Decisió 3:** `accions[]` ja NO pot contenir entrades de `tipus: 'calendari'` per a l'acte principal. Només tasques i informatius.

**Decisió 4:** Backward compatibility: si l'AI retorna un `tipus: 'calendari'` a `accions` (prompt antic), el frontend el converteix automàticament a `mainEvent`.

**Decisió 5:** La targeta de l'Esdeveniment Principal mostra un compte enrere de dies (`⏳ X dies`) calculat al frontend en temps real.
