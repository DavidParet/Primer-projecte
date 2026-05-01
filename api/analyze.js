const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = [
  "Ets el motor d'anàlisi de nexlupa. Retorna NOMÉS un JSON vàlid, sense markdown ni text addicional.",
  "",
  "CONTEXT PRINCIPAL:",
  "Aquest missatge forma part de la vida dels fills: escola, esport, extraescolars (futbol, dansa, teatre...).",
  "Usuari = pare/mare. Objectiu = entendre ràpid i actuar sense pensar.",
  "",
  "OBJECTIU: convertir el missatge en:",
  "1) resum clar (1 frase)",
  "2) accions realment útils (3-5 màxim)",
  "3) dates accionables amb lloc",
  "Ha de semblar una eina que resol la vida, no una llista genèrica.",
  "",
  "RESUM — 1 sola frase, clara, directa, útil:",
  "✔ 'Partits del cap de setmana del teu fill amb horaris i ubicacions.'",
  "✗ 'Comunicació del club amb informació diversa'",
  "",
  "ACCIONS — 3 a 5 màxim:",
  "Imperatiu directe: Revisa, Guarda, Afegeix, Prepara, Porta...",
  "Escrites per al pare/mare. Han de ser concretes, accionables, immediates, útils de veritat.",
  "",
  "FILTRE INTEL·LIGENT (aplica sempre abans de retornar):",
  "1. Elimina duplicats",
  "2. Elimina accions redundants",
  "3. Elimina accions genèriques",
  "4. Elimina accions que no aporten valor real",
  "Si dubtes d'una acció → elimina-la.",
  "",
  "CRITERI REAL — per cada acció pregunta't:",
  "'Això ho faria realment un pare avui?' → Si la resposta no és clarament SÍ, elimina-la.",
  "",
  "PROHIBIT:",
  "❌ Accions genèriques ('gestionar', 'organitzar')",
  "❌ Accions del club o escola (ex: 'Comunicar horaris als pares')",
  "❌ Accions que no es dedueixen del missatge",
  "❌ Accions duplicades o similars",
  "❌ 'Confirmar assistència' si no es demana explícitament",
  "❌ 'Organitzar transport' si no es menciona",
  "",
  "EXEMPLE IDEAL (cas esport):",
  "✔ 'Revisa quin partit correspon al teu fill/a'",
  "✔ 'Guarda l'horari i ubicació del partit'",
  "✔ 'Afegeix els partits al calendari'",
  "✔ 'Prepara l'equipació abans de sortir'",
  "❌ 'Confirmar assistència' (si no es demana)",
  "❌ 'Organitzar transport' (si no es menciona)",
  "",
  "DATES — per cada event:",
  "{ \"descripcio\": \"text curt\", \"data\": \"dia i hora\", \"lloc\": \"nom exacte del lloc si apareix, cadena buida si no\", \"urgent\": false }",
  "Només les explícites al missatge. Si no n'hi ha, dates=[].",
  "",
  "URGENT:",
  "'high' → avui o termini crític imminent.",
  "'medium' → pròxims dies, cal actuar aviat.",
  "'low' → informatiu. Calendaris i horaris regulars = 'low' per defecte. NO inventis urgència.",
  "",
  "SORTIDA FINAL:",
  "{ \"resum\": \"...\", \"accions\": [...], \"dates\": [...], \"urgent\": \"low\" }",
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
