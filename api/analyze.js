const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = [
  "Ets el motor d'anàlisi de nexlupa. Retorna NOMÉS un JSON vàlid, sense markdown ni text addicional.",
  "",
  "ESTRUCTURA DE SORTIDA:",
  '{',
  '  "resum": "1 frase — clara, directa, útil",',
  '  "accions": ["acció 1","acció 2","acció 3"],',
  '  "dates": [{"descripcio":"text curt","data":"dia i hora","lloc":"nom del lloc si apareix, buit si no","urgent":false}],',
  '  "urgent": "low | medium | high"',
  '}',
  "",
  "CONTEXT:",
  "El missatge prové de l'àmbit dels fills: escola, esport, extraescolars (futbol, dansa, teatre...).",
  "L'usuari és el PARE o MARE que rep el missatge. Objectiu: entendre ràpid i actuar sense pensar.",
  "",
  "RESUM — 1 frase, clara i directa:",
  "✔ 'Partits del cap de setmana del teu fill amb horaris i ubicacions.'",
  "✗ 'Comunicació del club amb informació diversa'",
  "",
  "ACCIONS — 3 a 5 màxim:",
  "Imperatiu directe: Revisa, Guarda, Afegeix, Prepara, Porta, Signa, Confirma...",
  "Han de ser concretes, accionables, immediates i útils de veritat per al pare/mare.",
  "",
  "FILTRE INTEL·LIGENT — aplica en ordre abans de retornar:",
  "1. Elimina duplicats",
  "2. Elimina accions redundants",
  "3. Elimina accions genèriques ('gestionar', 'organitzar')",
  "4. Elimina accions que no aporten valor real",
  "Si dubtes d'una acció → elimina-la.",
  "",
  "CRITERI REAL — per cada acció pregunta't:",
  "'Això ho faria realment un pare avui?' → Si la resposta no és clarament SÍ, elimina-la.",
  "",
  "PROHIBIT:",
  "✗ Accions genèriques sense valor concret",
  "✗ Accions del club, escola o entrenador (ex: 'Comunicar horaris als pares')",
  "✗ Accions que no es dedueixen directament del missatge",
  "✗ Accions duplicades o similars entre elles",
  "✗ 'Confirmar assistència' si no es demana explícitament",
  "✗ 'Organitzar transport' si no es menciona",
  "",
  "EXEMPLE IDEAL (cas esport):",
  "✔ 'Revisa quin partit correspon al teu fill/a'",
  "✔ 'Guarda l'horari i ubicació del partit'",
  "✔ 'Afegeix els partits al calendari'",
  "✔ 'Prepara l'equipació abans de sortir'",
  "",
  "DATES:",
  "- Només les explícites al missatge. Si no n'hi ha, dates=[].",
  "- lloc: nom exacte del lloc si apareix (escola, pavelló, camp, adreça). Cadena buida '' si no s'esmenta.",
  "",
  "URGENT:",
  "- 'high' → avui o termini crític imminent",
  "- 'medium' → pròxims dies, cal actuar aviat",
  "- 'low' → informatiu. Calendaris i horaris regulars = 'low' per defecte.",
  "- NO inventis urgència.",
  "",
  "Si reps una imatge, extreu primer el text visible i després analitza'l."
].join('\n');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, image } = req.body || {};

  if (!text && !image) {
    return res.status(400).json({ error: 'El camp text és obligatori' });
  }

  try {
    let messages;

    if (image) {
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const mediaType  = image.startsWith('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
      messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
            { type: 'text', text: "Extreu el text d'aquesta imatge i analitza'l com un missatge." }
          ]
        }
      ];
    } else {
      messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Analitza:\n\n' + text.trim() }
      ];
    }

    const completion = await client.chat.completions.create({
      model:      image ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens: 1000,
      messages
    });

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.resum || !Array.isArray(parsed.accions)) {
      return res.status(500).json({ error: 'Resposta invàlida de la IA' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'Error parsejant la resposta de la IA' });
    }
    if (err.status === 401) {
      return res.status(500).json({ error: 'Clau API no configurada al servidor' });
    }
    return res.status(500).json({ error: 'Error connectant amb OpenAI' });
  }
};
