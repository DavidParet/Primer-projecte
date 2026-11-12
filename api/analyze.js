const OpenAI = require('openai');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { madridToday, weekdayForISO, validIsoDate, normalizeAnalysis } = require('../lib/nexlupa-result');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'ai', 'nexlupa-core-ai-prompt-v2.txt'),
  'utf8'
);

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, image, sourceDate, language, testReferenceDate } = req.body || {};

  if (!text && !image) {
    return res.status(400).json({ error: 'El camp text és obligatori' });
  }

  try {
    let today = madridToday();
    // Referència QA fixa només a la branca preview protegida o amb clau de servidor.
    // Mai a producció per una petició d'usuari ordinari.
    const previewQa = process.env.VERCEL_ENV === 'preview' &&
      process.env.VERCEL_GIT_COMMIT_REF === 'fix/claude-50-casos-20261112';
    const sentKey = String(req.headers['x-nexlupa-qa-key'] || '');
    const keyQa = !!process.env.NEXLUPA_QA_KEY &&
      sentKey.length === process.env.NEXLUPA_QA_KEY.length &&
      crypto.timingSafeEqual(Buffer.from(sentKey), Buffer.from(process.env.NEXLUPA_QA_KEY));
    if (previewQa || keyQa) {
      const fixed = validIsoDate(testReferenceDate);
      if (fixed) today = fixed.slice(0, 10);
    }
    const original = validIsoDate(sourceDate);
    const locale = ['ca','es','en','fr'].includes(language) ? language : 'ca';
    const prompt = SYSTEM_PROMPT + '\n\nCONTEXT TEMPORAL DEL SERVIDOR: avui és ' +
      weekdayForISO(today) + ' ' + today + ' (Europe/Madrid).' +
      '\nData original del missatge (si fiable): ' + (original || 'no disponible') + '.' +
      '\nIdioma de sortida: ' + locale + '. Calcula totes les dates relatives segons aquest context.';
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
      model:       image ? 'gpt-4o' : (process.env.NEXLUPA_TEXT_MODEL || 'gpt-4o'),
      max_tokens:  5000,
      temperature: 0,
      messages,
      response_format: { type: 'json_object' }
    };

    const completion = await client.chat.completions.create(completionOpts);

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    let parsed = JSON.parse(raw);

    if (!parsed.resum || !Array.isArray(parsed.accions)) {
      return res.status(500).json({ error: 'Resposta invàlida de la IA' });
    }

    // Normalització determinista: preserva tots els esdeveniments, dates i dades útils.
    const fromImage = !!image && !text;
    parsed = normalizeAnalysis(parsed, typeof text === 'string' ? text : '', today, original, { fromImage });

    // Una sola reconsulta quan una expressió inequívocament futura ha produït dates passades.
    const ntext = typeof text === 'string'
      ? text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    const futureText = /\b(?:dema|passat dema|manana|pasado manana|que ve|vinent|setmana vinent|semana que viene|proper|proxim|proximo|siguiente)\b/.test(ntext);
    const isPast = x => x && x.data && x.data.slice(0, 10) < today && !x.vençut && !(original);
    const pastFuture = futureText && (
      parsed.esdeveniments.some(isPast) || parsed.accions.some(isPast)
    );
    if (pastFuture) {
      try {
        const again = await client.chat.completions.create({
          ...completionOpts,
          messages: messages.concat([
            { role: 'assistant', content: JSON.stringify(parsed) },
            { role: 'user', content: 'Revisa les dates: el missatge conté referències futures però hi ha dates passades. ' +
              'Respecta els terminis ja vençuts i els fets històrics; corregeix NOMÉS dates futures errònies. ' +
              'No perdis cap tasca, esdeveniment o dada útil. Retorna JSON complet.' }
          ])
        });
        const candidate = JSON.parse(again.choices[0].message.content);
        if (candidate && Array.isArray(candidate.accions) && candidate.resum) {
          const fixed = normalizeAnalysis(candidate, text, today, original, { fromImage });
          const stillPast = fixed.esdeveniments.some(isPast) || fixed.accions.some(isPast);
          if (!stillPast) parsed = fixed;
        }
      } catch (retryError) { /* es tracta com a reconsulta fallida */ }
      // Si segueix havent-hi dates passades en un missatge amb referències futures, mai les enviem
      // al calendari: es buiden i l'usuari rep l'avís de confirmar-les.
      const stillBad = [...parsed.esdeveniments, ...parsed.accions].filter(isPast);
      if (stillBad.length) {
        stillBad.forEach(x => { x.dataOriginal = x.data; x.data = null; x.dataFi = null; });
        parsed.avisDates = [parsed.avisDates,
          'No hem pogut determinar amb seguretat la data d’algun element; confirma-la abans de guardar-la.']
          .filter(Boolean).join(' ');
        parsed.revisioDates = { requereixRevisio: true,
          camps: stillBad.map(x => x.title || x.accio) };
        parsed.mainEvent = parsed.esdeveniments[0] || null; // mateix objecte que la llista
      }
    }

    parsed.dataReferencia = today;
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
