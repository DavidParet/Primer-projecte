# NEXLUPA — Correus corporatius existents i pilot Resend
**Revisió:** 7 de novembre de 2026 · **Estat:** comprovació històrica, no auditoria en directe de Zoho/Resend.

## Correus que ja es van configurar a Zoho (maig 2026)
- `david@nexlupa.app`: bústia Zoho principal.
- `info@nexlupa.app`: àlies corporatiu sobre la bústia principal.
- `lupa@nexlupa.app`: àlies «La Lupa». **És l'adreça universal que es va proposar per al reenviament de circulars a NEXLUPA V1**; no és una bústia independent i no és encara un receptor operatiu integrat al motor de fitxes.
- `hola@nexlupa.app`: adreça proposada però **no consta que s'hagi activat**; consta un rebot de prova el 31/05/2026: «550 5.1.1 User does not exist».

A Gmail hi ha missatges rebuts el 08/05/2026 de `david@nexlupa.app` i el 19/05/2026 de `lupa@nexlupa.app`, que confirmen funcionament **en aquelles dates**. L'estat actual de recepció de cada àlies a Zoho continua pendent d'una verificació autoritzada; no deduir-lo de l'enviament històric.

## Decisió funcional: conservar els correus públics
**No crear `lupa@` per segona vegada ni canviar els MX de `nexlupa.app`** per apuntar-los a Resend; afectaria altres bústies Zoho. No tancar, suprimir, reanomenar ni reenviar àlies Zoho sense aprovació explícita.

Per a un pilot de Resend, emprar en primer lloc l'adreça de recepció de proves `<àlies>@<id>.resend.app` que assigni realment el compte Resend; **mai inventar el valor id**. Això permet provar Resend sense tocar DNS.

Quan la integració estigui validada, avaluar dues vies:
1. **Mantenir `lupa@nexlupa.app` com a adreça visible** i establir, amb autorització, una regla de reenviament/ingesta des de Zoho al motor; comprovar com afecta l'autenticació, les capçaleres, l'origen real i la identificació de família.
2. **Adreces familiars úniques en un subdomini segregat** de proves com `entrada.nexlupa.app`, amb MX específic per a Resend i sense modificar els MX de `nexlupa.app`. Les adreces familiars s'han de generar com a tokens no predictibles i validar-se; `lupa@` continuaria com a identitat de marca, però les entrades multiusuari necessiten enrutar-se de forma segura.

Una bústia universal amb el mateix destinatari per a tothom no identifica per si sola l'usuari; ha d'existir un mecanisme fiable d'autorització i associació a família i activitat.

## Instruccions per a Claude + connector Resend
- Connectar el connector oficial: https://claude.com/connectors/resend
- Llegir primer dominis, bústies, límits i esdeveniments de recepció del compte Resend.
- Preparar només una **prova aïllada**, sense DNS, Vercel ni Zoho de producció.
- Registrar l'adreça de recepció que Resend assigni de debò i verificar si suporta `email.received`.
- No crear API keys ni webhooks productius ni enviar missatges reals sense permís.
- No compartir secrets o dades familiars al xat o GitHub.

**Cap modificació de MX, comptes Zoho, DNS, producció, preus ni `main`.** Treball de codi de NEXLUPA només en `product/whatsapp-premium-20261107`.

## Fonts d'operació
- Resend inbound: https://resend.com/features/inbound
- Resend Claude connector: https://claude.com/connectors/resend
