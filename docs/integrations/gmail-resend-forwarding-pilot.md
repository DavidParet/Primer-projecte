# NexLupa · Primer pilot Gmail → Resend (sense OAuth restringit)

**Estat de treball 10/11/2026:** desenvolupament aïllat, PR #16 en draft. NO enviar ni reenviar correus reals fins que la família pilot, el consentiment i el pipeline d'entrada s'hagin verificat. La producció de NexLupa no incorpora aquest mòdul.

## Circuit objectiu

1. Una família autoritza explícitament `resend_forward/read_school_mail` i obté una adreça d'entrada aleatòria i no predictible com `in-<32 hex>@entrada.nexlupa.app`. L'alias no revela dades personals.
2. Gmail verifica l'adreça de reenviament. Es crea UN filtre exclusivament per als remitents/comunicacions escolars aprovats. **No activar el reenviament global**. Els missatges continuen a Gmail.
3. Resend (domini receptor verificat) notifica `email.received` al webhook per POST.
4. Abans de llegir JSON o informació de missatges, el servidor valida la signatura Svix del **cos cru**, la marca de temps i la mida. Rebutja modificacions i replays; no exposa secrets.
5. L'aplicació exigeix un sol destinatari per al pilot i cap adjunt; resol el destinatari mitjançant una consulta SQL segura, no amb `From`, `Subject` ni el contingut del correu.
6. Consulta l'associació familiar i el consentiment vigent abans de registrar una única recepció de metadades. La cua ha de tenir una restricció UNIQUE sobre la clau SHA-256 per deduplicar retries i webhooks.
7. **Segona fase, no implementada al PR #16:** un treballador amb autorització recupera un únic correu via l'API de Resend, comprova de nou família, consentiment, qualitat i integritat del missatge, i crea una proposta de fitxa per revisió humana. Sense accions automàtiques, enviaments ni Calendar.

## Evidència constatada

- Resend: `entrada.nexlupa.app` verificat, `Receiving: enabled`, `Sending: disabled`. Un únic webhook estable `email.received` habilitat; el webhook de preview duplicat s'ha desactivat.
- El codi del receptor estable `nexlupa-resend-pilot` actual només fa verificació criptogràfica. NO equival a ingestió de contingut en NexLupa.
- Neon, branca aïllada `resend-worker-consent-validation-20261108`: `intake_bridge_health()` retorna `receipts=2`, `pending=1`, `signed_family_matches=0`, `eligible_for_processing=0`, `blocked_unrouted=1`. No s'han llegit dades de missatges.
- Nou mòdul `lib/forwarding/resend-intake.cjs`: signatura, destinatari únic, alias aleatori, consentiment revalidat i hash idempotent. `lib/forwarding/neon-receipt.cjs`: adaptador **en codi, no desplegat** que prepara un rebut de metadades xifrat AES-256-GCM i un INSERT amb autorització atòmica via RPC + ON CONFLICT, sense llegir el cos del correu. Ja existeix el codi HTTP aïllat del pilot, però sense desplegament verificat del commit més recent i sense secrets, associacions o correus reals.
- Tests de `tests/forwarding-*.test.cjs` i GitHub Actions `forwarding-intake-tests.yml`: **34/34 correctes**, última execució #42922613403, sense Gmail, Resend ni Neon durant les proves automatitzades; les consultes a Neon real es documenten més avall.
- Preview de Vercel del commit `f1edf3002886849c051df99f1c834ad59a161779`: **READY**. Per eliminar l'error de patrons de rutes del `main` s'han adaptat `vercel.json` i `scripts/build-static.js` de la branca Gmail verificada. Aquest solapament s'ha de resoldre abans de fusionar cap PR.

## Portes pendents abans del pilot amb correus ficticis

- [ ] Identitat de família pilot verificada a Neon i consentiment explícit registrat.
- [ ] Alias aleatori associat a família amb `resolve_authorized_recipient` i revocació funcional. Sense alias no es pot atribuir cap correu a una família.
- [x] Comprovar en PostgreSQL real la deduplicació seqüencial amb una família i consentiment ficticis, sense deixar registres.
- [ ] Verificar concurrència real PostgreSQL, la compatibilitat de l'embolcall AES-256-GCM amb el worker, revocació concurrent i limitació de taxa; les 34 proves offline i la prova SQL seqüencial no substitueixen aquestes verificacions.
- [x] Ruta HTTP de preview **implementada en codi**, separada del webhook estable; signatura comprovada abans d'inicialitzar PostgreSQL; cap resposta amb dades privades. **Encara pendent: desplegament i prova HTTP en Vercel**.
- [ ] Confirmació de l'adreça a Gmail i filtre selectiu definit amb revisió humana; sense reenviament global.
- [ ] Prova de 1–3 correus **inventats**, sense dades personals ni de menors: un accepted/queued, un duplicate, un no autoritzat i revocació.
- [ ] Comparar recepció amb fitxes en revisió i comprovar zero enviaments/Calendar. No publicar a `main` sense aprovació.

## Font de procediment

- Google: https://support.google.com/mail/answer/10957 — la verificació és obligatòria; els filtres de reenviament només afecten missatges futurs i són alternatius al reenviament global.
- Resend: https://resend.com/features/webhooks — format `email.received` i metadades del webhook.

**Conclusió:** hem validat el codi de la barrera d'entrada, no el circuit complet. Falta específicament vincular l'alias al consentiment i a la cua abans de tractar missatges.


### Barrera tècnica observada — permisos del rol de recepció

**Històric:** el rol `nexlupa_resend_ingest` inicialment no tenia USAGE de l'esquema RPC ni EXECUTE de `resolve_authorized_recipient(text)`. **Actualització 11/11/2026:** s'han concedit només aquests dos permisos, exclusivament a la branca **no principal** de Neon `resend-worker-consent-validation-20261108`. Comprovació posterior: és l'única de les 13 funcions RPC executable per aquest rol; continua sense USAGE directe a l'esquema de dades familiars. La funció aplica alias actiu, família pilot/activa i consentiment `resend_forward/read_school_mail` no revocat. Cap permís nou a la branca primària.

### Darrera comprovació CI

[GitHub Actions run 42922613403](https://github.com/DavidParet/Primer-projecte/actions/runs/42922613403): **34 tests, 34 pass, 0 fail**, més instal·lació correcta de dependències `pg` i comprovació d'importació del nou endpoint. Inclou revocació, deduplicació, cua xifrada de metadades, signatura Svix, proves HTTP i bloqueig de producció. Sense accés a Gmail, Resend ni Neon a CI; la producció continua sense integració Gmail.


### Validació tècnica del 11/11/2026

**Neon real, branca aïllada i rol `nexlupa_resend_ingest`:** 
- `GRANT USAGE ON SCHEMA nexlupa_worker_rpc` i `GRANT EXECUTE ON FUNCTION nexlupa_worker_rpc.resolve_authorized_recipient(text)`, sense altres EXECUTE ni accés directe a taules familiars.
- Execució amb credencials del **rol destinatari real**: destinatari fictici no autoritzat retorna `NULL`. L'INSERT SQL complet amb el mateix destinatari retorna `outcome='revoked'`. No genera fila: `unexpected_receipts=0`.
- L'indicador de la cua no ha variat: `receipts=2`, `pending=1`, `signed_family_matches=0`, `eligible_for_processing=0`, `blocked_unrouted=1`.
- **Prova positiva seqüencial executada a PostgreSQL real:** família, alias i consentiment ficticis creats sota SAVEPOINT; primera recepció `inserted`, segona idèntica `duplicate`, i `ROLLBACK TO SAVEPOINT` verificat: 0 famílies, aliases i rebuts ficticis restants. L'execució de la prova positiva s'ha fet amb el rol propietari necessari per crear les fixtures, **no** amb el rol receptor de webhook. Aquest darrer ha passat la prova real negativa de permisos i alias desconegut.
- **Prova de consentiment revocat executada:** amb una fixture 100% fictícia de consentiment amb `revoked_at` informat, `resolve_authorized_recipient` ha retornat `NULL`; després de rollback queden 0 consentiments ficticis.
- La **concurrència d'INSERT**, la revocació simultània amb una recepció i la compatibilitat amb el desxifrat del worker **encara no s'han executat** sobre PostgreSQL, i continuen pendents abans del pilot real.

**Codi HTTP preview afegit, però encara NO desplegat en la darrera revisió:**
- `api/forwarding/pilot-webhook.js` i `lib/forwarding/{http-handler,runtime}.cjs` posen el processament darrere de triple condició: Vercel `preview`, branca exacta de pilot i `FORWARDING_PILOT_ENABLED=true`. Producció sempre inhabilitada.
- `FORWARDING_PILOT_ENABLED=false` s'ha desat explícitament a les variables de Vercel **només per a aquesta branca**. No s'ha creat cap secret de Resend ni cap encaminament de webhook a la nova ruta.
- El GET de supervisió només indica configuració, **no afirma una connexió real a Neon**. El POST compara la signatura abans de preparar la connexió PostgreSQL. Els errors transitoris responen 503 per permetre reintents; els rebuts rebutjats s'acusen sense filtració de contingut.
- `package.json` ara inclou el connector PostgreSQL `pg` i GitHub Actions verifica la càrrega del mòdul Vercel.

**Bloqueig de desplegament:** un intent explícit de previsualització de l'últim commit ha retornat **HTTP 402**, recurs `api-deployments-free-per-day` (límit diari de més de 100 despl.). El darrer desplegament `READY` visible era d'un commit anterior a l'endpoint nou. No s'ha fet cap actualització de pla, càrrec, promoció ni fusió de PR; no afirmar verificació HTTP del nou endpoint fins que Vercel ho permeti.

**Fites encara no completades:** provar INSERT positiu i idempotència/revocació amb fixtures aïllats i consentits, validar endpoint de preview HTTP, crear vincle alias-família de prova, configurar exclusivament el reenviament selectiu amb verificació de Gmail i completar el flux fins a fitxa de revisió. La recepció real a Resend continua separada de l'API nova.
