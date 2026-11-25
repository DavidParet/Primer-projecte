const OpenAI = require('openai');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { madridToday, weekdayForISO, validIsoDate, normalizeAnalysis, sanitizeNotice, explicitDayMonthInSource } = require('../lib/nexlupa-result');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'ai', 'nexlupa-core-ai-prompt-v2.txt'),
  'utf8'
);

// PLANS: encara no hi ha comptes. Cap indicador del navegador («sóc Premium») es té en compte.
// ACCÉS PREMIUM DE PROVES (temporal): només a la preview de la branca ui-2.0, mai a producció.
// El navegador ha d'enviar una clau secreta; el servidor en compara l'empremta SHA-256.
// La clau no és al repositori (només la seva empremta). Si es defineix NEXLUPA_PREMIUM_TEST_KEY a Vercel
// (només Preview), té prioritat i substitueix l'empremta.
const PREMIUM_TEST_SHA256 = 'b39bc2a7ec3222c40100d6c4dac5a0bec8fbd1b17ed1429972bef890437058e1';
function premiumTestAvailable() {
  return process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'ui-2.0';
}
function sha256(v) { return crypto.createHash('sha256').update(String(v), 'utf8').digest(); }
function hasVerifiedPremium(req) {
  if (!premiumTestAvailable()) return false;                 // producció i altres branques: mai
  const sent = String((req.headers && req.headers['x-nexlupa-premium-test']) || '');
  if (sent.length < 20 || sent.length > 200) return false;
  const expected = process.env.NEXLUPA_PREMIUM_TEST_KEY
    ? sha256(process.env.NEXLUPA_PREMIUM_TEST_KEY)
    : Buffer.from(PREMIUM_TEST_SHA256, 'hex');
  return crypto.timingSafeEqual(sha256(sent), expected);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text: inputText, image, sourceDate, language, testReferenceDate } = req.body || {};

  // Comprovació d'accés de proves, sense consumir IA.
  if (req.body && req.body.premiumCheck === true) {
    return res.status(200).json({ testAccess: premiumTestAvailable(), premium: hasVerifiedPremium(req) });
  }
  const text = sanitizeNotice(inputText);

  if (!text && !image) {
    return res.status(400).json({ error: 'El camp text és obligatori' });
  }

  // PLANS (25/11/2026): l'anàlisi d'imatges i captures és exclusiva de Premium 1.0.
  // Es comprova al servidor ABANS de consumir l'API. No es confia en cap indicador enviat pel navegador.
  // Encara no hi ha sistema de comptes ni permisos (Fase 1 de l'acta): fora de l'accés de proves de la preview,
  // tota petició amb imatge es rebutja. Quan existeixin els comptes, verificar aquí la sessió i el pla.
  if (image && !hasVerifiedPremium(req)) {
    return res.status(403).json({ error: 'L’anàlisi d’imatges i captures és exclusiva de Premium.', code: 'PREMIUM_REQUIRED' });
  }

  try {
    let today = madridToday();
    // Referència QA fixa només a la branca preview protegida o amb clau de servidor.
    // Mai a producció per una petició d'usuari ordinari.
    const previewQa = process.env.VERCEL_ENV === 'preview' &&
      ['fix/claude-50-casos-20261112','fix/qa96-deterministic-dates-20261112'].includes(process.env.VERCEL_GIT_COMMIT_REF);
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
        { role: 'user', content: JSON.stringify({ missatge: text }) }
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
    // Q1: una data passada que el missatge diu explícitament («7 de novembre») és un fet, no un error:
    // no es demana al model que la «corregeixi» (podria canviar-ne el mes) i es mostra marcada per confirmar.
    const isPast = x => x && x.data && x.data.slice(0, 10) < today && !x.vençut && !(original) &&
      !(typeof text === 'string' && explicitDayMonthInSource(text, x.data.slice(0, 10)));
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
