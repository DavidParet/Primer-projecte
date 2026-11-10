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
- Nou mòdul `lib/forwarding/resend-intake.cjs`: signatura, destinatari únic, alias aleatori, consentiment revalidat i hash idempotent. `lib/forwarding/neon-receipt.cjs`: adaptador **en codi, no desplegat** que prepara un rebut de metadades xifrat AES-256-GCM i un INSERT amb autorització atòmica via RPC + ON CONFLICT, sense llegir el cos del correu. Encara no existeix cap connector HTTP del pilot end-to-end.
- Tests `tests/forwarding-intake.test.cjs` + `tests/forwarding-neon-receipt.test.cjs` i GitHub Actions `forwarding-intake-tests.yml`: **22/22 correctes**, execució #42920286787, sense connexions externes ni secrets.
- Preview de Vercel del commit `f1edf3002886849c051df99f1c834ad59a161779`: **READY**. Per eliminar l'error de patrons de rutes del `main` s'han adaptat `vercel.json` i `scripts/build-static.js` de la branca Gmail verificada. Aquest solapament s'ha de resoldre abans de fusionar cap PR.

## Portes pendents abans del pilot amb correus ficticis

- [ ] Identitat de família pilot verificada a Neon i consentiment explícit registrat.
- [ ] Alias aleatori associat a família amb `resolve_authorized_recipient` i revocació funcional. Sense alias no es pot atribuir cap correu a una família.
- [ ] Verificar en PostgreSQL **real** el format xifrat de l'adaptador de cua i la concurrència/idempotència, confirmar compatibilitat amb el worker i limitar la taxa. La comprovació offline 22/22 no substitueix aquesta validació.
- [ ] Ruta HTTP de preview separada del webhook estable; verificador de signatures integrat, cap resposta amb dades privades.
- [ ] Confirmació de l'adreça a Gmail i filtre selectiu definit amb revisió humana; sense reenviament global.
- [ ] Prova de 1–3 correus **inventats**, sense dades personals ni de menors: un accepted/queued, un duplicate, un no autoritzat i revocació.
- [ ] Comparar recepció amb fitxes en revisió i comprovar zero enviaments/Calendar. No publicar a `main` sense aprovació.

## Font de procediment

- Google: https://support.google.com/mail/answer/10957 — la verificació és obligatòria; els filtres de reenviament només afecten missatges futurs i són alternatius al reenviament global.
- Resend: https://resend.com/features/webhooks — format `email.received` i metadades del webhook.

**Conclusió:** hem validat el codi de la barrera d'entrada, no el circuit complet. Falta específicament vincular l'alias al consentiment i a la cua abans de tractar missatges.


### Barrera tècnica observada — permisos del rol de recepció

A la branca Neon de validació, la consulta de privilegis ha confirmat que el rol `nexlupa_resend_ingest` pot fer INSERT i SELECT a `nexlupa_pilot.resend_inbox_queue`, però **no pot executar** `nexlupa_worker_rpc.resolve_authorized_recipient(text)` ni té USAGE a l'esquema RPC. Aquest és un bloqueig real per connectar l'adaptador de forma segura. La funció SQL aplica alias actiu, família activa/pilot i consentiment `resend_forward/read_school_mail` no revocat. **No s'han concedit permisos nous**; qualsevol GRANT ha de limitar-se a aquesta funció concreta i provar-se a la branca aïllada abans de continuar.

### Darrera comprovació CI

[GitHub Actions run 42920286787](https://github.com/DavidParet/Primer-projecte/actions/runs/42920286787): **22 tests, 22 pass, 0 fail**, incloent revocació a l'INSERT atòmic, deduplicació, xifrat de metadades, contingut no fiable, firma Svix i URLs no autoritzades. Sense accés a comptes reals. La producció continua sense integració Gmail.
