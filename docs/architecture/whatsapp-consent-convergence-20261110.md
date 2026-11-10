# NexLupa WhatsApp · Convergència de consentiment (10-11-2026)

**Estat: DRAFT / prova tècnica. No fusionar, no desplegar, no activar Meta ni importar missatges reals.**

## Evidències comprovades

- PR #7 (`feat/whatsapp-durable-inbox-v1`): vinculació des de missatge entrant signat per Meta, codi d'un sol ús, operacions signades, proves amb identitat familiar canònica fictícia, control de permisos i model d'esborrat/retenció. El codi és **intern** i les taules/rols `nex_ci_*` són només per a CI.
- PR #8: proveïdor separat de prova del número i comprovant de consentiment web explícit. La migració `20261109_whatsapp_explicit_consent_receipt.sql` preserva el resum HMAC del comprovant i impedeix reutilitzar-lo.
- PR #15: els dos prototips es revisen sobre una sola branca basada en la PR #7 avançada, sense substituir els seus mòduls. A `lib/whatsapp/consent-policy.js`, la via antiga ara exigeix `authorizeFamily` per a alta i baixa; l'alta torna a comprovar permisos després dels adaptadors asíncrons; la baixa exigeix `authorizeFamilyTransaction` per verificar/immobilitzar la pertinència administrativa dins de la transacció.
- Prova `tests/whatsapp-consent-sql-lifecycle.test.cjs`: PostgreSQL 16 efímer, dues famílies fictícies, rebut únic, xifrat, duplicats, baixa i purga, nova alta.
- GitHub Actions [#42915391895](https://github.com/DavidParet/Primer-projecte/actions/runs/42915391895): **SUCCESS**; executa també regressions de pairing Meta signat, identitat canònica, revocació i concurrència SQL amb dues connexions.
- L'estat de CI confirma només aquests tests sintètics. Cap prova demostra que un usuari real pugui iniciar sessió, consentir o enviar missatges al sistema.

## Decisió de disseny per evitar dues vies incompatibles

**No connectar simultàniament els dos endpoints/prototips d'alta.** El futur flux d'activació ha de tenir una única operació de consentiment auditable i vinculada de manera atòmica al mateix usuari, família, compte empresarial i número.

**Flux canònic proposat (pendent de revisió de producte i privacitat):**

1. La persona adulta responsable inicia sessió a NexLupa mitjançant un IdP real, comprovat al servidor; el backend autoritza rol i família en la BD.
2. La interfície mostra abast `incoming_text`, limitacions de reenviament, retenció, privacitat de terceres persones i mecanisme de revocació; un comprovant explícit i únic es genera al servidor.
3. El backend emet un repte d'un sol ús vinculat a la família i al número de negoci; l'usuari confirma des del seu WhatsApp al canal oficial. La signatura de Meta demostra la procedència del missatge; **no substitueix** la identitat familiar ni la informació/acceptació del consentiment.
4. Una única transacció amb rol restringit valida comprovant i repte, permisos actuals i unicitat del remitent, marca ambdós com consumits i crea exactament una autorització auditada amb caducitat definida.
5. En revocació, bloqueig de noves entrades, supressió de contingut i registre mínim sense dades personals en clar.

No s'ha implementat encara el pas 4 que combini els dos prototips; el prototip web de PR #8 **no es considera un segon camí apte per a producció**. Cap assentiment suposat a partir d'un número o d'un reenviament ha de donar permís.

## Barreres de llançament reals

- [ ] IdP d'ús real, sessió servidor amb revocació, alta de famílies i rols amb proves de dues famílies. Neon Auth continua sense acreditar-se com actiu.
- [ ] Esquema canònic de famílies i consentiments aprovat i migrat només en una branca aïllada de Neon, amb rollback, RLS i funcions/rols mínims; cap `nex_ci_*` a producció.
- [ ] Consentiment informat/auditable segons les normes aplicables, amb revisió de menors, tercers i contingut reenviat; política de conservació i supressió exercitable.
- [ ] Operació signada que **combini** el repte de número i el comprovant explícit, en la mateixa transacció, amb tests d'atacs/replay i revocació simultània.
- [ ] Meta Business/Cloud API oficial, número dedicat, verificació de signatura RAW, secrets sota custòdia segura; no lectura automàtica de grups preexistents.
- [ ] Ingestió segura en preview Vercel, errors i reintents limitats, cua d'incidències, protecció de dades, alertes i control d'abús.
- [ ] Confirmar rotació/revocació del possible token històric de Vercel i revisar les filtracions antigues.
- [ ] Proves E2E supervisades amb dades fictícies i decisions explícites abans de qualsevol ús real.

**Prioritat immediata:** prova del pairing canònic i del comprovant únic en PostgreSQL/Neon aïllat amb rol limitat i evidència de CI; evitar més mòduls redundants. La connexió en viu de Meta està bloquejada fins a validar identitat, permisos i privacitat.
