# NexLupa — WhatsApp Business webhook (segona fase)
Data: 8 de novembre de 2026 · Estat: només preparat al codi, DESACTIVAT.

## Objectiu
Preparar l'entrada oficial de missatges reenviats voluntàriament per les famílies a un número NexLupa WhatsApp Business, NO obtenir accés als grups escolars existents.

## Què s'ha implementat
- api/whatsapp-webhook.js: endpoint Vercel amb verificació Meta hub.mode, hub.verify_token, hub.challenge.
- lib/whatsapp/webhook-security.js: signatura obligatòria X-Hub-Signature-256 amb HMAC-SHA256 dels bytes originals i comparació temporalment segura; límit 256 KiB.
- Rebuig de peticions sense configuració, amb token incorrecte, sense signatura, amb JSON invàlid o massa grans.
- lib/whatsapp/delivery-normalizer.js: interpreta text i referències multimèdia dels POST signats, ignora estats de lliurament i duplicats del lot; qualsevol família/grup/consentiment queda pendent de verificació externa.
- tests/whatsapp-webhook.test.js i tests/whatsapp-delivery-normalizer.test.js: proves amb dades de ficció; cap missatge real ni clau al repositori.
- CI independent dins .github/workflows/whatsapp-webhook-tests.yml.

## Configuració futura (NO activada)
Variables exclusivament al servidor, mai a GitHub, al navegador ni en aquest document:
- WHATSAPP_WEBHOOK_MODE: per defecte absent/desactivat. L'única modalitat acceptada actualment és verify-only.
- WHATSAPP_VERIFY_TOKEN: secret inventat per NexLupa, que també s'introdueix a la consola Meta per al GET inicial.
- WHATSAPP_APP_SECRET: secret real de l'aplicació Meta, utilitzat per a la signatura HMAC dels POST.

**IMPORTANT:** verify-only només habilita GET amb token correcte. El POST és validat tècnicament però retorna 503 **sempre**, fins i tot si la signatura és bona: no hi ha encara una cua duradora on confirmar la recepció. Això evita respondre 200 a missatges perduts. No habilitar la subscripció de missatges reals mentre el processament durador no estigui fet; un 503 pot provocar reintents de Meta.

No s'han modificat les variables d'entorn de Vercel, no s'ha connectat Meta, no s'ha comprat número, no s'ha enviat cap missatge i no s'ha desplegat a producció.

## Flux segur de la futura fase 3
1. Identificar l'empresa i el número emissor via canal oficial.
2. Verificar HMAC sobre cos RAW; cap confiança en camps del JSON fins a aquesta verificació.
3. Validar estructura, identificador de missatge i dimensions.
4. Emmagatzemar durablement amb clau única (compte Meta, ID de missatge) abans de retornar 200; les entregues poden repetir-se.
5. Associar el número, amb consentiment, a una **família** concreta. No suposar grup d'origen d'un missatge reenviat.
6. Classificar per activitat i grup definit per l'usuari; no barrejar famílies.
7. Extreure informació estrictament referenciada i reconciliar correccions/conflictes amb el mòdul de la fase 1.
8. Presentar les fitxes vives amb revisió d'informació dubtosa.
9. Sincronitzar Google Calendar només amb autorització explícita.
10. Política documentada de tractament de dades de menors i tercers, control d'accés, retenció i eliminació.

## Proves i acceptació
- node --test tests/whatsapp-webhook.test.js tests/whatsapp-delivery-normalizer.test.js (només biblioteca estàndard de Node.js 22).
- GitHub Actions: suite passada al commit c07072ea414bb5f83eb3e3b01c78d1309d63200f; el mòdul encara no s'ha provat amb Meta real.
- Test de l'entorn real de Vercel encara pendent. La documentació de Vercel exposa req.body com un getter de parseig lazy; aquest webhook mai accedeix a req.body, i llegeix el flux RAW. Cal validar-ho amb vercel dev o un preview abans de connectar Meta.
- S'han de veure POST sense signatura -> 403; POST vàlid -> 503 (fins tenir cua); GET sense token vàlid -> 403; GET vàlid -> challenge exacte.

## Fonts tècniques
- Meta: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Vercel Functions Node.js: https://vercel.com/docs/functions/runtimes/node-js

## Estat de les altres tasques
- Fase 1, parser + fitxes vives: PR #5, independent i encara esborrany.
- Fase 2, webhook de verificació: branca feat/whatsapp-webhook-verification-v1, independent i sense canvis a main.
- Fase 3, emmagatzematge i enviament/recepció real: NO implementada.

## Coordinació amb la resta del projecte
- PR #3 (reparació Vercel): encara pendent; la validació de Vercel de la PR #6 falla per la configuració de rutes antiga de main. No duplicar aquesta reparació aquí.
- PR #4 (agent familiar): ja disposa del pipeline d'activitats i del canal WhatsApp en el seu contracte; connectar-lo només després d'identificar família i activitat amb consentiment, i de garantir persistència idempotent.
- PR #5 (parser d'exports) i #6 (webhook oficial) no estan fusionades, ni disponibles a l'aplicació pública.
