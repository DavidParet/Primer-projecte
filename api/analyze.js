const OpenAI = require('openai');
const path   = require('path');
const fs     = require('fs');
const { localDate, messageDate, validateAnalysis, weekday } = require('../lib/analysis-dates');

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

  const { text, image: rawImage } = req.body || {};
  const image = typeof rawImage === 'string' ? rawImage : '';
  const source = typeof text === 'string' ? text.trim() : '';

  if (!source && !image) {
    return res.status(400).json({ error: 'El camp text és obligatori' });
  }

  try {
    const now = new Date();
    const today = localDate(now);
    const anchor = messageDate(image ? '' : source, today);
    const prompt = SYSTEM_PROMPT + '\n\nAvui (Europe/Madrid): ' + weekday(today) + ' ' + today +
      '. Referència per al text: ' + (anchor ? weekday(anchor) + ' ' + anchor : 'incerta; conserva les dates relatives sense convertir-les') + '.';
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
        { role: 'user', content: 'Analitza:\n\n' + source }
      ];
    }

    const completionOpts = {
      model:       image ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens:  4000,
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

    const legacyEvents = parsed.accions.filter(action => action?.tipus === 'calendari');
    parsed.accions = parsed.accions.filter(action => action && action.tipus !== 'calendari');
    parsed.esdeveniments = [...(Array.isArray(parsed.esdeveniments) ? parsed.esdeveniments : []), ...legacyEvents];
    if (!parsed.mainEvent && parsed.esdeveniments.length) {
      parsed.mainEvent = parsed.esdeveniments.shift();
    }

    // Also keep literal URLs when the model omits them from the extracted details.
    const links = (image ? [] : source.match(/https?:\/\/[^\s<>"«»]+/gi) || [])
      .map(link => link.replace(/[.,;!?]+$/, ''))
      .map(link => link.endsWith(')') && link.split(')').length > link.split('(').length ? link.slice(0, -1) : link);
    const details = Array.isArray(parsed.dadesUtils) ? parsed.dadesUtils : [];
    const facts = details.filter(detail => typeof detail === 'string');
    parsed.dadesUtils = [...new Set([...facts, ...links.filter(link => !facts.some(fact => fact.includes(link)))])];

    return res.status(200).json(validateAnalysis(parsed, image ? '' : source, today, now));

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
