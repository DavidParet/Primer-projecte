# Motor de Prioritats — Esdeveniment Principal

**Data:** 2026-06-13  
**Repositori de prompts estratègics de NexLupa**

---

## Objectiu de la millora

Refinar el motor de prioritats de NexLupa perquè deixi de mostrar només P1 i P2 i adopti una jerarquia molt més intuïtiva i útil per a les famílies.

L'usuari ha d'entendre el missatge en menys de 5 segons.

---

## Prompt complet

Actua com un enginyer sènior de producte i frontend.

### OBJECTIU

Refinar el motor de prioritats de NexLupa perquè deixi de mostrar només P1 i P2 i adopti una jerarquia molt més intuïtiva i útil per a les famílies.

L'usuari ha d'entendre el missatge en menys de 5 segons.

---

### NOVA ESTRUCTURA OBLIGATÒRIA

#### 1. ESDEVENIMENT PRINCIPAL

- Detectar l'acte o situació central del missatge.
- Ha de ser sempre el primer bloc i el més destacat visualment.
- Incloure data, hora i lloc sempre que sigui possible.

Exemples:
- Festival de fi de curs
- Excursió
- Reunió de famílies
- Sortida al CosmoCaixa
- Festa de l'escola

---

#### 2. P1 — ACCIONS IMPRESCINDIBLES

Només accions obligatòries o que requereixen una actuació clara.

Exemples:
- Confirmar assistència
- Fer un pagament
- Signar una autorització
- Respondre abans d'una data
- Portar documentació obligatòria

Si no n'hi ha, mostrar:

"No s'han detectat accions imprescindibles."

---

#### 3. P2 — PREPARACIÓ

Elements útils per preparar l'esdeveniment però que no són crítics.

Exemples:
- Portar samarreta blanca
- Arribar 30 minuts abans
- Portar esmorzar
- Portar ampolla d'aigua
- Material necessari

---

#### 4. INFORMACIÓ ADDICIONAL

Informació contextual que no requereix cap acció.

Exemples:
- Hi haurà servei de bar
- Obertura de portes
- Es podran fer fotografies
- Recomanacions generals

---

### CRITERI FONAMENTAL

Mai barrejar l'Esdeveniment Principal amb les accions.

**Exemple correcte:**

```
ESDEVENIMENT PRINCIPAL
Festival de fi de curs
7 de juny · 18:00 · Teatre de Gavà

P1
Confirmar assistència abans del 3 de juny.

P2
Portar samarreta blanca.

INFORMACIÓ ADDICIONAL
Les portes obriran a les 17:30.
```

L'Esdeveniment Principal és el context.
P1 és el que s'ha de fer.
P2 és la preparació.
La Informació Addicional és només contextual.

---

### INTERFÍCIE

- L'Esdeveniment Principal ha de ser el bloc visual dominant.
- P1 ha de destacar clarament com a accions obligatòries.
- P2 ha de tenir un estil de preparació.
- Informació Addicional amb estil neutre.
- Disseny premium, net, modern i molt llegible.

No implementar encara suport per a PDFs.

El MVP només ha d'acceptar:
- Text enganxat
- Pantallassos / imatges

---

### PROCÉS OBLIGATORI ABANS DE DONAR LA FEINA PER ACABADA

1. Comprovar que el projecte compila sense errors.
2. Fer commit amb un missatge descriptiu.
3. Fer push al repositori GitHub.
4. Esperar el desplegament de Vercel.
5. Verificar que el desplegament ha finalitzat correctament.
6. Obrir la URL pública de Vercel i comprovar visualment que els canvis es veuen.
7. Si no apareixen, revisar build logs, branch desplegada, caché i últim commit fins solucionar-ho.
8. No donar la tasca per finalitzada fins que la verificació visual sigui correcta.

---

## Justificació funcional

L'estructura anterior (alta/mitja/baixa) era massa abstracta per a l'usuari final. Una família que rep un missatge de l'escola necessita entendre immediatament:

1. **De quina cosa s'està parlant** (l'Esdeveniment Principal)
2. **Què ha de fer sí o sí** (P1 — Accions imprescindibles)
3. **Què ha de preparar** (P2 — Preparació)
4. **Informació útil però no urgent** (Informació addicional)

Aquesta jerarquia reflecteix el model mental real de les famílies i elimina la càrrega cognitiva de interpretar codis de prioritat abstractes (alta/mitja/baixa).

La regla fonamental és que **l'Esdeveniment Principal mai es barreja amb les accions**: és el context, no una tasca. Aquesta separació és la innovació central d'aquesta iteració del motor.

---

## Decisió de producte adoptada

**Decisió:** Substituir el sistema de prioritats P1/P2/baixa per una jerarquia de 4 blocs visuals:

| Bloc | Propòsit | Visual |
|------|----------|--------|
| Esdeveniment Principal | Context de l'acte central | Dominant, fons daurat |
| P1 — Accions imprescindibles | Accions obligatòries | Vermell, destacat |
| P2 — Preparació | Preparació no crítica | Ambre, suau |
| Informació addicional | Context sense acció | Gris, neutre |

**Mapping tècnic des del JSON de la IA:**
- `tipus === 'calendari'` → Esdeveniment Principal
- `prioritat === 'alta'` + `tipus !== 'calendari'` → P1
- `prioritat === 'mitja'` + `tipus !== 'calendari'` → P2
- `prioritat === 'baixa'` o `tipus === 'informatiu'` → Informació addicional

**Limitació MVP:** No s'implementa suport per a PDFs. Només text i imatges.

**Raó:** Velocitat de comprensió < 5 segons per a l'usuari final.
