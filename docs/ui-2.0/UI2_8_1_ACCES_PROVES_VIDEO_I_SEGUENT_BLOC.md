# NexLupa · UI 2.8.1 — Accés Premium de proves, correcció del vídeo V9f i següent bloc

Branca `ui-2.0` · commit de l'app desplegada `34932ef` · Interfície 2.8.1 · 2026-11-25 · Main i producció sense canvis.
El disseny aprovat no s'ha tocat: lupa, llum, X, implosió, halo, tipografia i distribució.

## 1. Comparativa unificada amb l'acta
- Retirats «Altres correus: reenviament manual», la fitxa «Outlook i altres proveïdors» i la frase «Amb altres proveïdors, es preveu el reenviament manual». No consten a l'acta.
- Criteri visual: marca verda quan el pla inclou la funció, límits en text neutre (inclòs «3 al dia»), guió neutre quan no està inclosa i «previst» amb llegenda.
- **Informe setmanal PDF:** es manté a Premium com a «previst». L'acta i l'encàrrec del vídeo no en defineixen el contingut, el període que cobreix ni el dia de lliurament. **Pendent de definir.** No s'ha inventat res.

## 2. Accés Premium de proves (només preview)
**Mecanismes revisats:**
- La preview té la protecció d'accés de Vercel (només el compte de l'equip).
- El servidor ja tenia una clau de QA (`x-nexlupa-qa-key`) per fixar la data de referència.
- No hi ha cap sistema de comptes.

**Implementació:**
- El servidor (`api/analyze.js`) accepta imatges només si:
  1. l'entorn és la preview de la branca `ui-2.0` (`VERCEL_ENV=preview` i `VERCEL_GIT_COMMIT_REF=ui-2.0`);
  2. la petició porta una clau d'accés vàlida. El servidor en compara l'empremta SHA-256 en temps constant.
- **Producció i altres branques:** sempre denegat, encara que la clau sigui correcta.
- El repositori només conté l'empremta de la clau, no la clau.
- Es pot canviar la clau definint `NEXLUPA_PREMIUM_TEST_KEY` a Vercel (només *Preview*): té prioritat sobre l'empremta. La meva connexió amb Vercel no té permís per crear variables d'entorn; ho ha de fer el propietari.
- Cap indicador «sóc Premium» del navegador (`premium`, `plan`, capçaleres de pla) es té en compte.
- `premiumCheck` comprova l'accés sense consumir IA.
- **Interfície:** a Config apareix la targeta «Accés Premium de proves» només quan el servidor diu que l'accés està disponible, és a dir, només a la preview. Amb la clau validada pel servidor, la pestanya «Imatge · Premium» mostra la càrrega normal i fa servir el mateix recorregut d'anàlisi i el servei d'IA real.
- **FREE:** la càrrega, l'arrossegament i les peticions directes continuen bloquejats.

**Com s'hi entra:** obrir la preview → Config → «Accés Premium de proves» → enganxar la clau → «Activar». La clau no consta en aquest informe; s'ha lliurat a part.

## 3. Proves
**Proves automàtiques** (`npm test` 280/280, amb una clau fictícia per variable d'entorn):
- preview `ui-2.0` + clau correcta → la imatge arriba al model;
- clau incorrecta → 403 sense IA;
- producció → 403 i `premiumCheck` diu `testAccess: false`;
- una altra branca → 403;
- clau inventada contra l'empremta → 403;
- `premiumCheck` no consumeix IA;
- FREE: el text funciona, i una imatge sense permís o amb un indicador fals és rebutjada.

**Proves de navegador:**
- E2E 43/43: Calendar manual, Maps, Tasques i Historial al FREE.
- A 360, 390 i 412 px i amb el text al 115 %: panell Premium visible; fitxer o arrossegament sense càrrega; anàlisi forçada amb 0 crides a l'API; sense desbordaments ni textos vermells.

**Prova real amb IA:** **pendent.** Des d'aquest entorn no es pot fer cap petició a la preview:
- el servidor intermediari bloqueja `*.vercel.app`;
- Claude in Chrome no estava connectat;
- el connector de Vercel no té permís per crear entorns de prova.

Hi ha dues imatges fictícies preparades (`captura_escola.png`, `cartell_foto.jpg`) amb aquest contingut esperat:
- **Captura de l'escola:** sortida al Museu Marítim de Barcelona el dimecres 9 de desembre; sortida 8:45 h, tornada 16:30 h; 14 € abans del 3 de desembre; autorització signada abans del 4 de desembre; portar esmorzar, dinar i aigua.
- **Cartell:** Festa de Nadal, dissabte 19 de desembre de 10:00 a 13:00 h; pati de l'escola, C/ dels Pins, 12 · Sant Cugat; xocolatada 2 €; inscripcions al taller fins al 15 de desembre (ampa@elspins.cat).

El consum previst són 2 crides al model d'imatge (gpt-4o), més la reconsulta de dates si escau.

## 4. Vídeo V9f
**Corregit** a partir del muntatge V9f, sense refer el muntatge sencer: s'han tornat a renderitzar les escenes PREMIUM i les novetats a partir de `anim8.html` i s'ha aplicat només la diferència sobre els màsters. L'àudio no canvia i les transicions s'han recalculat igual que a `compose12.py`. Els originals V9f es conserven intactes.

Fitxers nous a `nexlupa_video/V9f_PREMIUM_CORREGIT/`:
- 96 s amb rètols;
- 96 s màster sense rètols;
- 84 s variant curta.

| Escena | Abans | Ara |
|---|---|---|
| PREMIUM 1.0 (fila d'icones) | ∞ (il·limitat) | lupa |
| Novetat 1 | «Anàlisis il·limitades · Sense límit diari» + ∞ | «Més anàlisis · Més marge que el FREE» + lupa |
| Totes les novetats | «NOVETAT n» | «PREMIUM 1.0 · PROPERAMENT» |
| Fotografies i captures | «NOVETAT 3» | «PREMIUM 1.0 · PROPERAMENT» (identificada com a Premium) |
| Recordatoris | «Recordatoris de calendari» + notificacions del mòbil | «Recordatoris de terminis · Per correu, abans de cada data límit» + avisos de correu |
| Informe setmanal | «Tota la setmana familiar en un sol PDF» + «Tasques · Dates · Pagaments» | «Un informe setmanal en PDF» (sense definir-ne el contingut) |

**Pendent al vídeo:**
- No s'han posat quotes ni preus, perquè no hi ha confirmació comercial.
- L'escena de resultat de la foto inclou un botó «Recordar la data». Cal decidir si es manté.
- L'encàrrec del 24/11 demana una peça nova de 30 s; aquesta correcció només afecta el V9f.

## 5. Següent bloc: comptes, plans i quotes (no implementat)
**Què hi ha al repositori:**
- **Sense comptes ni base de dades.** Només hi ha `api/analyze.js`; no hi ha Neon ni Resend al codi d'aquesta branca ni de `main`.
- **Quota FREE:** només al navegador (`localStorage nxl_usage`, `FREE_LIMIT = 3`) i desactivada amb `DEV_MODE = true`. Es pot saltar esborrant les dades del navegador.
- **Premium:** no hi ha pla, pagament ni comptadors mensuals.

**Què falta:**
1. **Identificació:**
   - alta i inici de sessió (per exemple, enllaç màgic per correu);
   - sessió amb galeta segura `HttpOnly`;
   - separació de dades per família.
2. **Model de dades:**
   - `usuaris`;
   - `plans` (free / premium);
   - `consums` (data, tipus text/imatge/correu, usuari).
3. **Quotes al servidor**, abans de cridar l'IA i de manera atòmica:
   - FREE: 3 anàlisis de text al dia, zona horària Europe/Madrid;
   - Premium: 1.000 de text al mes, correus inclosos, i 50 d'imatge al mes;
   - resposta clara quan s'arriba al límit.
4. **Permisos:** `hasVerifiedPremium(req)` llegirà la sessió i el pla de la base de dades. L'accés de proves es retirarà o quedarà limitat a la preview.
5. **Límit de peticions** per IP i per usuari a l'endpoint d'IA.
6. **Llançament:**
   - `DEV_MODE = false`;
   - retirar la targeta d'accés de proves de producció (ja hi és desactivada);
   - el comptador del navegador queda només com a informació visual;
   - proves d'accés entre famílies.
7. **Pagament:** depèn de l'aprovació comercial; no s'ha de començar sense aquesta decisió.
