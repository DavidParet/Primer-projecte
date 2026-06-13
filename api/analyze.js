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

    const completionOpts = {
      model:       image ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens:  1000,
      temperature: 0,
      messages
    };
    if (!image) completionOpts.response_format = { type: 'json_object' };

    const completion = await client.chat.completions.create(completionOpts);

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.resum || !Array.isArray(parsed.accions)) {
      return res.status(500).json({ error: 'Resposta invàlida de la IA' });
    }

    /* ── POST-PROCESSAMENT SERVER-SIDE: fallback mainEvent en 3 capes ──────
     * Garanteix que l'event principal mai aparegui com a targeta MITJA,
     * independentment del que retorni la IA.
     */
    const EVT_KEY_RE = /\b(festa|jornada|torneig|reuni[oó]|sortida|acte|festival|excursi[oó]|espectacle)\b/i;

    if (!parsed.mainEvent) {
      let srcIdx = -1;

      // Capa 1: tipus === 'calendari'
      for (let i = 0; i < parsed.accions.length; i++) {
        if (parsed.accions[i].tipus === 'calendari') {
          const a = parsed.accions[i];
          parsed.mainEvent = { title: a.accio, data: a.data || null, lloc: a.lloc || null, edat: a.edat || null };
          srcIdx = i;
          break;
        }
      }

      // Capa 2: data + (lloc o keyword d'event)
      if (!parsed.mainEvent) {
        for (let i = 0; i < parsed.accions.length; i++) {
          const a = parsed.accions[i];
          if (a.data && (a.lloc || EVT_KEY_RE.test(a.accio || ''))) {
            parsed.mainEvent = { title: a.accio, data: a.data || null, lloc: a.lloc || null, edat: a.edat || null };
            srcIdx = i;
            break;
          }
        }
      }

      // Elimina l'acció usada com a mainEvent → no pot arribar al frontend com a MITJA
      if (srcIdx !== -1) {
        parsed.accions = parsed.accions.filter((_, idx) => idx !== srcIdx);
      }
    }
    /* ──────────────────────────────────────────────────────────────────── */

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
