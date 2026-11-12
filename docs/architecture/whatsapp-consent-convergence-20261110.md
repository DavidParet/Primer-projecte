# NexLupa WhatsApp · Convergència de consentiment (10-11-2026)

**Estat: DRAFT / prova tècnica. No fusionar, no desplegar, no activar Meta ni importar missatges reals.**

## Evidències comprovades

- PR #7 (`feat/whatsapp-durable-inbox-v1`): vinculació des de missatge entrant signat per Meta, codi d'un sol ús, operacions signades, proves amb identitat familiar canònica fictícia, control de permisos i model d'esborrat/retenció. El codi és **intern** i les taules/rols `nex_ci_*` són només per a CI.
- PR #8: proveïdor separat de prova del número i comprovant de consentiment web explícit. La migració `20261109_whatsapp_explicit_consent_receipt.sql` preserva el resum HMAC del comprovant i impedeix reutilitzar-lo.
- PR #15: els dos prototips es revisen sobre una sola branca basada en la PR #7 avançada, sense substituir els seus mòduls. A `lib/whatsapp/consent-policy.js`, la via antiga ara exigeix `authorizeFamily` per a alta i baixa; l'alta torna a comprovar permisos després dels adaptadors asíncrons; la baixa exigeix `authorizeFamilyTransaction` per verificar/immobilitzar la pertinència administrativa dins de la transacció.
- Reforç posterior: l'alta també exigeix una connexió PostgreSQL dedicada amb `BEGIN` i `READ COMMITTED`; comprova permisos amb `authorizeFamilyTransaction` sota bloqueig de fila, revisa la validesa de les proves després de qualsevol espera, i només llavors fa l'INSERT i `COMMIT`. Error o pèrdua de permisos = `ROLLBACK`. La prova de cursa de membres és sintètica i comprova que una baixa d'administrador concurrent impedeix l'alta.
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

## Limitació específica després del bloqueig SQL

La nova transacció garanteix una comprovació d'administrador consistent **si** l'adaptador de confiança adquireix el bloqueig real de membres. **Encara no és una transacció única de tot el consentiment**: els verificadors externs de control del número i rebut poden consumir-se abans que la transacció PostgreSQL escrigui l'autorització. Cal una prova i un disseny de consum de comprovants/reptes exactament un cop, amb registre durador i recuperació davant d'errors, dins del futur pairing canònic. No utilitzar aquesta via de demostració com a endpoint públic.


## Prototip nou: prova i rebut d'un sol ús en una transacció (TTP atomic, 10/11/2026)

**Validació:** GitHub Actions [#42918745448](https://github.com/DavidParet/Primer-projecte/actions/runs/42918745448), commit `f885cef5`, conclusió `success`. La regressió específica `tests/whatsapp-atomic-consent-enrollment.test.cjs` ha passat en PostgreSQL 16 efímer.

**Implementació interna a PR #15:**

- `db/migrations/20261110_whatsapp_atomic_pairing_evidence_staged.sql`: dues taules per guardar **únicament digests HMAC** de la prova verificada de WhatsApp i del rebut explícit del web. Ambdues vinculen família, compte/número oficial i digest del remitent; el rebut també vincula el digest de la prova i la versió actual del consentiment. `ENABLE/FORCE RLS` i sense política, cap credencial d'usuari ni privilegi públic concedit. **NO és migració aprovada per Neon.**
- `lib/whatsapp/atomic-consent-enrollment.js`: prova a prova i rebut es bloquegen mitjançant `SELECT ... FOR UPDATE` amb una connexió PostgreSQL dedicada. L'autorització de família es comprova transaccionalment, es comproven les identitats i l'abast de totes les proves, s'insereix una única autorització i es marquen **ambdós justificants consumits a la mateixa transacció**. Si falla una escriptura, un retorn no queda verificat o hi ha duplicat, s'executa `ROLLBACK` i no es consumeix cap justificant.
- `tests/whatsapp-atomic-consent-enrollment.test.cjs`: proves sintètiques de registre positiu, replay, altra família, caducitat, baixa del permís, fallada entre INSERT i actualització de rebut, recuperació i dues altes simultànies.
- El mòdul anterior `lib/whatsapp/consent-policy.js` **continua sent un prototip no destinat a endpoints públics**: els seus verificadors externs poden consumir comprovants abans de la transacció, i no ofereix la nova garantia. En una integració real cal **seleccionar el mòdul atòmic**, no activar els dos camins paral·lels.

**Falta imprescindible abans d'un pilot real:**

1. Emissor de proves: el backend de Meta ha de registrar el digest de prova **només després de validar signatura HMAC RAW i confirmar que el missatge procedeix del compte receptor**. No existeix encara el codi de producció que faci aquesta escriptura en la taula nova.
2. Emissor de rebuts: una sessió d'administrador autenticada de debò ha d'acceptar explícitament condicions i escriure el rebut, vinculat a la mateixa família i prova. Tampoc s'ha connectat.
3. Rols restringits: les proves actuals executen la migració en un PostgreSQL **efímer amb superusuari CI**; que passin no verifica la seguretat de rols de Neon. Cal funció `SECURITY DEFINER` auditada, `search_path` fixat, comprovació de sessió i permisos amb rol sense `BYPASSRLS`, i prova de permisos negatius.
4. Caducitat, retenció, exercici de supressió i gestió d'errors/reintents de Meta: polítiques operatives i revisió jurídica/privacitat, especialment per tercers/menors.
5. No desplegar cap endpoint que accepti missatges com a persistits fins validar el circuit sencer amb dades fictícies, una sessió familiar real i un compte Meta oficial configurat.

**Aquesta CI només prova l'atomicitat del registre de proves ja verificades, no la veracitat de les proves ni la seguretat d'un emissor real.** Els ids de família, número i remitents del test són sintètics. Producció, Resend i Neon no s'han modificat.


## Validació addicional de seguretat (10/11/2026)

- `lib/whatsapp/atomic-consent-enrollment.js` només admet proves i rebuts amb data de verificació/acceptació **no futura ni anterior a 15 minuts** respecte del rellotge de PostgreSQL, a més de la caducitat. No es pot allargar unilateralment un `expires_at` d'una prova antiga i fer-la útil.
- La prova PostgreSQL `tests/whatsapp-atomic-consent-enrollment.test.cjs` també cobreix proves antigues, rebuts amb data futura, rebuts antics i la substitució fraudulenta del vincle entre rebut i prova.
- La prova `tests/whatsapp-atomic-consent-rls.test.cjs` crea **només en el PostgreSQL efímer de CI** un rol `NOSUPERUSER NOBYPASSRLS NOINHERIT`. Encara que rebi permisos explícits SELECT i INSERT sobre les taules, les polítiques de denegació per defecte l'impedeixen llegir registres i crear-ne. No disposa de SELECT sobre autoritzacions.
- Resultat verificat: [GitHub Actions #42919346721](https://github.com/DavidParet/Primer-projecte/actions/runs/42919346721), **SUCCESS**. Inclou les regressions prèvies, el nou circuit atòmic, proves de dates i prova de rol restringit.
- **Limitació:** aquesta prova confirma l'aïllament `default deny` per a un rol sense privilegis. No valida encara una funció productiva `SECURITY DEFINER` ni un rol limitat autoritzat a escriure els justificants de forma segura a Neon. Els emissors reals de prova Meta i rebut web **continuen sense connectar**.

L'únic resultat apte per a aprovació actual és **codi i proves en branca draft**, no l'activació del pilot real.
