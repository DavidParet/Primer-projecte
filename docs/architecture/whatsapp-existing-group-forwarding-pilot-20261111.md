# NexLupa · WhatsApp — pilot de reenviament voluntari (11/11/2026)

**Estat: prototip de codi i CI; NO GO per a Meta real, números particulars o producció.**

## Decisió de producte: no prometre lectura automàtica de grups particulars

L'objectiu original de NexLupa és resumir comunicacions de grups escolars i extraescolars. Això **no** equival a disposar d'una API oficial per entrar i llegir grups preexistents. La WhatsApp Business Platform permet missatges 1:1 a un número empresarial autoritzat. La Groups API actual correspon a **grups nous creats per comptes Official Business Account elegibles**, amb un màxim reduït de participants i entrada per invitació; no converteix el WhatsApp familiar en una font llegible per bots.

Referències de verificació:
- Documentació Meta: https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started
- Anàlisi de requisits i límits 2026: https://kapso.com/blog/whatsapp-groups-api-state-2026

Per això el pilot no pretén connectar-se a grups escolars existents, ni usar sessions no oficials, automatitzar WhatsApp Web o accedir a missatges de terceres persones sense permís.

## Camí de dades proposat (només amb proves fictícies)

1. Un adult administrador de la família s'autentica i accepta explícitament la lectura de text entrant i les condicions de retenció.
2. Vincula voluntàriament el número remitent a la seva família, mitjançant verificació per Meta i prova de consentiment diferent. L'alta i la revocació s'autoritzen contra la identitat familiar canònica.
3. **La persona decideix què reenviar**: obre el WhatsApp que ja fa servir i reenvia un avís seleccionat en un xat individual amb el número oficial NexLupa (quan estigui autoritzat). No es dona accés automàtic al grup d'origen.
4. El webhook verifica signatura sobre bytes originals i límits del missatge; el backend comprova la vinculació vigent. Les dades acceptades es xifren i es dedupliquen abans d'una resposta de confirmació.
5. NexLupa interpreta el text com a informació aportada voluntàriament i l'usuari podrà indicar manualment l'activitat/grup, si és rellevant. **No es pot assegurar quin grup, autor original ni context complet tenia el missatge reenviat**.
6. En revocar el consentiment, els missatges posteriors deixen d'admetre's. Cal verificar el circuit d'esborrat i retenció abans del pilot real.

## Regles funcionals verificables

- `normalizeMetaDeliveries()` fixa `groupId=null`, `familyId=null` i `authorization='unresolved'`, independentment dels camps extra al payload.
- `persistDelivery()` rebutja un `groupId` inventat. No confia en un `familyId` que vingui del navegador ni en un suposat rol del remitent.
- Les proves inclouen Meta signat fictici, consentiment sintètic, revocació, aïllament de dues famílies, text xifrat i cap grup d'origen reconstruït.
- Cap prova CI o deployment preview prova encara un número de Meta real ni els seus permisos.

## Pendent abans d'un pilot autoritzat

- Preparar i revisar esquemes preview específics de Neon, amb rols restringits i cap dada familiar real.
- Validar webhook, fitxes, revocació i retenció d'extrem a extrem amb dues famílies fictícies.
- Confirmar elegibilitat, costos i permisos del número empresarial amb Meta; revisió de privacitat per comunicacions escolars i dades de tercers.
- No habilitar missatgeria real, ni connectar cap grup privat, sense comprovacions i aprovació expressa.

Aquesta decisió defineix la **primera versió factible**, no una promesa de lectura o sincronització automàtica de grups existents.
