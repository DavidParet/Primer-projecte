const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = [
  "Ets el motor d'anàlisi de nexlupa. Retorna NOMÉS un JSON vàlid, sense markdown ni text addicional.",
  "",
  "ESTRUCTURA DE SORTIDA:",
  '{',
  '  "resum": "1 frase — explica QUÈ és i QUÈ implica realment per a l\'usuari",',
  '  "accions": ["acció 1","acció 2","acció 3"],',
  '  "dates": [{"descripcio":"text curt","data":"dia i hora","lloc":"nom real del lloc si apareix, cadena buida si no","urgent":true/false}],',
  '  "urgent": "low | medium | high"',
  '}',
  "",
  "CONTEXT USUARI:",
  "- L'usuari és qui REP el missatge, no qui l'envia.",
  "- En context escola, esport o activitats → l'usuari és un PARE o MARE.",
  "- Totes les accions han d'estar enfocades a la seva vida real.",
  "",
  "RESUM:",
  "- 1 frase màxim. Explica QUÈ és i QUÈ implica realment.",
  "- CORRECTE: 'Partits del cap de setmana del teu fill amb horaris i ubicacions.'",
  "- INCORRECTE: 'Comunicació del club amb informació diversa'",
  "",
  "ACCIONS — FES AIXÒ:",
  "- Imperatiu, segona persona implícita: Revisa, Guarda, Apunta, Porta, Signa, Confirma, Prepara...",
  "- Màxim 5. Immediatament accionables. Rellevants per qui rep.",
  "- Si el missatge és informatiu (calendari, horaris): prioritza entendre + guardar. NO inventis gestions.",
  "- CORRECTE: 'Revisa quin partit correspon al teu fill/a', 'Guarda l'horari i ubicació', 'Prepara l'equipació abans de sortir', 'Signa l'autorització avui'.",
  "- PROHIBIT: 'Confirmar disponibilitat dels jugadors', 'Comunicar horaris als pares', 'Gestionar transport', qualsevol acció pròpia del club o entrenador.",
  "- Abans de generar les accions, pregunta't: 'Si jo fos aquest usuari, què necessito fer realment?'",
  "",
  "DATES:",
  "- Només les explícites al missatge. Si no n'hi ha, dates=[].",
  "- lloc: nom real del lloc (escola, pavelló, adreça) si apareix al text. Cadena buida '' si no s'esmenta.",
  "",
  "URGENT:",
  "- 'high' → avui o imminent, termini crític.",
  "- 'medium' → pròxims dies, cal actuar aviat.",
  "- 'low' → informatiu, sense urgència real. Un calendari d'horaris sol ser 'low' o 'medium'.",
  "- NO inventis urgència.",
  "",
  "ESTIL: curt, clar, sense soroll, sense explicar el procés. Eina que resol la vida, no resum intel·lectual.",
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
