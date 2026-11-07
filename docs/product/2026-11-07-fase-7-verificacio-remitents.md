# NEXLUPA Agent — Fase 7: política d'autenticació del reenviament familiar
**Data:** 7 de novembre de 2026 · **Branca:** `product/whatsapp-premium-20261107`
**Estat:** política i tests de seguretat; **NO** activada com a autenticació real de Mailgun.
**Restricció:** web, landing, tarifes, `main` i producció intactes.

## Context i decisió
A NEXLUPA, la família rep una circular al Gmail/Outlook personal i **la reenvia a un alias receptor únic NEXLUPA**. El backend ha de verificar **el destinatari i la identitat del reenviador**, abans d'analitzar dades de menors i associar-les a una fitxa de Ball, Escola, Bàsquet, etc.

Hi ha dues verificacions DIFERENTS:
1. **Signatura del webhook Mailgun** — verifica l'origen de la petició a NEXLUPA i ajuda a evitar falsificació i replay.
2. **Autenticació del correu remitent** — verifica si el missatge enviat des del compte personal passa una comprovació alineada de DKIM/SPF i DMARC, i si el reenviador està registrat amb aquesta família. La primera signatura NO certifica per si mateixa la segona.

## Novetat implementada
`lib/premium-email-sender-policy.js` incorpora la decisió conservadora `evaluateForwarderTrust()`:
- El webhook s'ha d'haver validat abans.
- La identitat `From` normalitzada ha de coincidir amb el remitent SMTP.
- L'adreça remitent ha d'estar inscrita a la família (per a aquest alias receptor).
- Hi ha d'haver un resultat **d'autenticació normalitzat per un adaptador de confiança**, no una cadena d'un missatge o un camp aportat per l'usuari.
- Exigeix **DMARC pass** i almenys **DKIM pass alineat amb el domini** o **SPF pass alineat amb el domini**. En el prototip, l'alineament és una comparació exacta de domini per minimitzar falsos positius; pot rebutjar missatges legítims amb subdominis o reenviament complex.
- Si una evidència falta, falla o és ambigua, **no accepta automàticament la identitat** i l'envia a revisió.

`tests/run-premium-email-sender-policy.js` prova adreces registrades, suplantacions, resultats DMARC falsos o absents, alineament incorrecte i casos de Gmail/Outlook **ficticis**.

## Verificació CI
GitHub Actions ha completat **12 suites de regressió** amb Node.js 22:
https://github.com/DavidParet/Primer-projecte/actions/runs/42372949692

La nova política està provada de forma aïllada; la seva integració en una petició real de Mailgun encara està pendent.

## Punt crític abans de connectar realment Mailgun
Mailgun va anunciar el **8 de maig de 2026** que les notificacions d'Inbound Routes a URLs inclouen resultats d'autenticació del remitent. No hi ha, en l'entorn actual, una captura real validada del format d'aquests camps. **No cal endevinar-ne el format ni convertir qualsevol capçalera MIME `Authentication-Results` en una prova fiable.**

Cal, per ordre:
1. Obtenir un compte i domini **de proves** de Mailgun o servei equivalent, sense canviar el domini principal.
2. Rebre un primer POST signat amb missatges **totalment inventats**, sense publicar-ne continguts ni claus a GitHub.
3. Validar i documentar el nom exacte, format i origen dels camps SPF/DKIM/DMARC de Mailgun. Les capçaleres aportades per un remitent no es poden acceptar com a evidència sense garanties de reescriptura/segregació pel proveïdor.
4. Crear un adaptador estricte per convertir **només aquests camps autenticats del proveïdor** a `providerAuth`. Lligar aquesta transformació a la verificació HMAC, no a un booleà del cos HTTP.
5. Testar un Gmail, Outlook, remitent no registrat i correu suplantat de **prova**, amb quarantena per a l'ambigüitat i revisió de falsos negatius.
6. Després, treballar en persistència xifrada, autoritzacions, tractament de PDF/adjunts i Google Calendar en dry-run.

## Observació sobre Mailgun JSON
Mailgun també va introduir el **22 de setembre de 2026** l'entrega JSON per a Routes que apunten a una URL amb final `json`. La signatura per a aquest format es comprova sobre el **cos HTTP complet**, amb capçaleres de signatura, no igual que el POST de formulari. El prototip actual utilitza **`application/x-www-form-urlencoded`** i no processa JSON ni adjunts. **No barrejar els dos mètodes de signatura.**

## Fonts
- https://www.mailgun.com/releases/authentication-results-in-inbound-route-url-posts/
- https://www.mailgun.com/releases/routes-json-payload-forward-destinations/
- https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks

**No hem connectat Gmail real, WhatsApp, Mailgun real ni Google Calendar.** Cap credencial, domini o dada privada s'ha introduït al repositori.
