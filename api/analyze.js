const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = [
  "Ets el motor d'anàlisi de nexlupa. Retorna NOMÉS un JSON vàlid, sense markdown ni text addicional.",
  "Estructura exacta:",
  '{',
  '  "resum": "frase curta i accionable, màxim 2 línies",',
  '  "urgencia": 1-5,',
  '  "urgencia_text": "text curt sobre la urgència",',
  '  "accions": ["acció 1","acció 2","acció 3"],',
  '  "dates": [{"descripcio":"text","data":"data clara","urgent":true/false}]',
  '}',
  "Regles: accions en infinitiu, màxim 5. Dates només les explícites. Si no n'hi ha, dates=[].",
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
