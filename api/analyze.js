const OpenAI = require('openai');
const path   = require('path');
const fs     = require('fs');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'ai', 'nexlupa-core-ai-prompt.txt'),
  'utf8'
);

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
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    const prompt = SYSTEM_PROMPT + '\n\nData actual de referència (Europe/Madrid): ' + today + '.';
    let messages;

    if (image) {
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const mediaType  = image.startsWith('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
      messages = [
        { role: 'system', content: prompt },
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
        { role: 'system', content: prompt },
        { role: 'user', content: 'Analitza:\n\n' + text.trim() }
      ];
    }

    const completionOpts = {
      model:       image ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens:  2000,
      temperature: 0,
      messages,
      response_format: { type: 'json_object' }
    };

    const completion = await client.chat.completions.create(completionOpts);

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.resum || !Array.isArray(parsed.accions)) {
      return res.status(500).json({ error: 'Resposta invàlida de la IA' });
    }

    if (!parsed.mainEvent) {
      const eventIndex = parsed.accions.findIndex(action => action?.tipus === 'calendari');
      if (eventIndex !== -1) {
        const [event] = parsed.accions.splice(eventIndex, 1);
        parsed.mainEvent = {
          title: event.accio, data: event.data || null, dataFi: event.dataFi || null,
          lloc: event.lloc || null, edat: event.edat || null
        };
      }
    }

    return res.status(200).json(parsed);

  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'No hem pogut completar l’anàlisi. Torna-ho a provar.' });
    }
    if (err.status === 401) {
      return res.status(500).json({ error: 'Clau API no configurada al servidor' });
    }
    return res.status(500).json({ error: 'Error connectant amb OpenAI' });
  }
};
