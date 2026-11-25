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
// Empremtes acceptades (UI 2.9): la clau de l'enllaç directe de proves i, si existeix, la variable de Vercel.
const PREMIUM_TEST_SHA256 = [
  'efe1cae5e381918f2e2b98ca2e97c367b240d8013be23fb91997f3dcf4dc70f0',
  'b39bc2a7ec3222c40100d6c4dac5a0bec8fbd1b17ed1429972bef890437058e1'
];
function premiumTestAvailable() {
  return process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'ui-2.0';
}
function sha256(v) { return crypto.createHash('sha256').update(String(v), 'utf8').digest(); }
function validTestKey(sent) {
  sent = String(sent || '');
  if (sent.length < 20 || sent.length > 200) return false;
  const got = sha256(sent);
  const expected = PREMIUM_TEST_SHA256.map(h => Buffer.from(h, 'hex'));
  if (process.env.NEXLUPA_PREMIUM_TEST_KEY) expected.unshift(sha256(process.env.NEXLUPA_PREMIUM_TEST_KEY));
  return expected.reduce((ok, e) => crypto.timingSafeEqual(got, e) || ok, false);
}
function hasVerifiedPremium(req) {
  if (!premiumTestAvailable()) return false;                 // producció i altres branques: mai
  return validTestKey(req.headers && req.headers['x-nexlupa-premium-test']);
}

// ── IMATGES (UI 2.9): primer es llegeix el text literal de la imatge i després s'analitza exactament
// com un missatge de text. Així la normalització té una font contra la qual comprovar dates, llocs,
// adreces i imports, en lloc de confiar en una interpretació directa de la imatge.
const TRANSCRIBE_PROMPT = 'Ets un lector de text (OCR). Transcriu LITERALMENT el text visible de la imatge, ' +
  'en ordre de lectura i conservant els salts de línia. No resumeixis, no interpretis, no corregeixis, ' +
  'no completis dades que no hi són i no afegeixis res. Si és una captura de xat o correu, separa el cos del missatge ' +
  'de la capçalera de l\'aplicació (nom del grup o xat, participants, remitent) i de l\'hora d\'enviament. ' +
  'Retorna només JSON: {"text":"cos literal del missatge o cartell","context":"capçalera, remitent i hora d\'enviament, o cadena buida"}';
async function transcribeImage(client, dataUrl) {
  const r = await client.chat.completions.create({
    model: 'gpt-4o', temperature: 0, max_tokens: 2000, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TRANSCRIBE_PROMPT },
      { role: 'user', content: [ { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        { type: 'text', text: 'Transcriu el text d\'aquesta imatge.' } ] }
    ]
  });
  let out = {};
  try { out = JSON.parse(r.choices[0].message.content); } catch (e) { out = {}; }
  return { text: typeof out.text === 'string' ? out.text.trim() : '',
           context: typeof out.context === 'string' ? out.context.trim() : '', usage: r.usage || null };
}

// Proves automàtiques amb el motor real (només preview, amb clau): GET /api/analyze?selftest=escola|cartell|text
// Llegeix les imatges originals del repositori i retorna transcripció, resposta del model i resultat normalitzat.
const SELFTEST = {
  escola:  { file: 'captura_escola.png', type: 'image/png' },
  cartell: { file: 'cartell_foto.jpg',  type: 'image/jpeg' },
  text:    { text: 'Hola famílies! El dijous 10 de desembre farem la festa de Nadal a l\'escola a les 15:00. Cal portar l\'autorització signada fins al 7 de desembre. El preu del berenar és de 3 €.' }
};
async function selftest(req, res) {
  const q = req.query || {};
  if (process.env.VERCEL_ENV !== 'preview' || !['ui-2.0', 'ui-2.0-proves'].includes(process.env.VERCEL_GIT_COMMIT_REF) ||
      !validTestKey(q.k)) return res.status(404).json({ error: 'Not found' });
  const c = SELFTEST[q.selftest]; if (!c) return res.status(400).json({ error: 'cas desconegut' });
  const t0 = Date.now();
  const input = { testReferenceDate: q.ref || '2026-11-25', language: 'ca', trace: true };
  if (c.file) {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui-2.0', 'proves_imatges', c.file));
    input.image = 'data:' + c.type + ';base64,' + buf.toString('base64');
  } else input.text = c.text;
  try {
    const r = await runAnalysis(input, { allowTestReference: true });
    return res.status(r.status).json({ cas: q.selftest, ms: Date.now() - t0, ...r.body });
  } catch (e) { return res.status(500).json({ error: String(e && e.message || e) }); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.query && req.query.selftest) return selftest(req, res);
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
    const previewQa = process.env.VERCEL_ENV === 'preview' &&
      ['fix/claude-50-casos-20261112','fix/qa96-deterministic-dates-20261112'].includes(process.env.VERCEL_GIT_COMMIT_REF);
    const sentKey = String(req.headers['x-nexlupa-qa-key'] || '');
    const keyQa = !!process.env.NEXLUPA_QA_KEY &&
      sentKey.length === process.env.NEXLUPA_QA_KEY.length &&
      crypto.timingSafeEqual(Buffer.from(sentKey), Buffer.from(process.env.NEXLUPA_QA_KEY));
    const r = await runAnalysis({ text: inputText, image, sourceDate, language, testReferenceDate },
      { allowTestReference: previewQa || keyQa });
    return res.status(r.status).json(r.body);
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

async function runAnalysis(input, opts) {
  const { image, sourceDate, language, testReferenceDate } = input;
  let text = sanitizeNotice(input.text);
  const trace = input.trace ? { usage: [] } : null;
  let imageContext = '';
  {
    let today = madridToday();
    // Referència QA fixa només a la branca preview protegida o amb clau de servidor.
    // Mai a producció per una petició d'usuari ordinari.
    if (opts && opts.allowTestReference) {
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
    let directImage = false;

    if (image) {
      const base64Data = image.includes(',') ? image.split(',')[1] : image;
      const mediaType  = image.startsWith('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
      const dataUrl = `data:${mediaType};base64,${base64Data}`;
      // 1) Lectura literal  2) Anàlisi com a text, amb la mateixa normalització que un missatge escrit.
      const tr = await transcribeImage(client, dataUrl);
      if (trace) { trace.transcripcio = tr; trace.usage.push(tr.usage); }
      if (tr.text.replace(/\s+/g, '').length >= 12) {
        text = sanitizeNotice(tr.text);
        imageContext = tr.context;
      } else {
        directImage = true; // sense text llegible: anàlisi directa de la imatge (comportament anterior)
        messages = [
          { role: 'system', content: prompt },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: "Extreu el text d'aquesta imatge i analitza'l com un missatge." } ] }
        ];
      }
    }
    if (!directImage) {
      const userMsg = { missatge: text };
      if (imageContext) userMsg.contextCaptura = imageContext; // grup, remitent i hora d'enviament: no són dades de l'acte
      messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify(userMsg) }
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
    if (trace) trace.usage.push(completion.usage || null);

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
    let parsed = JSON.parse(raw);
    if (trace) trace.model = JSON.parse(raw);

    if (!parsed.resum || !Array.isArray(parsed.accions)) {
      return { status: 500, body: { error: 'Resposta invàlida de la IA' } };
    }

    // Normalització determinista: preserva tots els esdeveniments, dates i dades útils.
    // Amb imatge transcrita, la font és el text llegit (fromImage només quan no n'hi ha).
    const fromImage = directImage;
    parsed = normalizeAnalysis(parsed, typeof text === 'string' ? text : '', today, original, { fromImage, origenImatge: !!image });

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
          const fixed = normalizeAnalysis(candidate, text, today, original, { fromImage, origenImatge: !!image });
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
    if (image && !directImage) parsed.textLlegit = text; // permet revisar què s'ha llegit de la imatge
    if (trace) parsed._traca = trace;
    return { status: 200, body: parsed };
  }
}
module.exports._runAnalysis = runAnalysis;
