# NexLupa WhatsApp · Signed atomic activation (11 novembre 2026)

**Estat: STAGED DRAFT / proves CI sintètiques, NO DISPONIBLE PER AL PILOT REAL.**

## Canvis implementats

- `db/migrations/20261111_whatsapp_signed_atomic_activation_ci.sql`: fixture de PostgreSQL 16 **només CI** amb dos rols `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, propietari de funció i runtime diferenciats. La funció `SECURITY DEFINER` (amb `search_path` fixat) llegeix dues evidències pseudonimitzades, valida família, número, vincle entre prova i rebut, política acceptada i actualitat de les dates; després inscriu autorització i marca **ambdós** justificants consumits dins de la mateixa transacció PostgreSQL.
- La funció només accepta un permís HMAC signat de durada màxima **60 s**, amb nonce d'un sol ús, família, compte/número, digests de prova/rebut i **versió** de consentiment vinculats en el text signat. Els no autoritzats i els replays es rebutgen. El runtime no té SELECT/INSERT/UPDATE directes a evidències, autoritzacions, nonces ni claus.
- `lib/whatsapp/signed-atomic-consent-client.js`: fàbrica **interna**, sense cap endpoint públic. Reutilitza el contracte de `bindVerifiedRequest`: comprova identitat i rol de família al servidor; signa les dades amb una tercera clau independent i torna a comprovar rol, usuari i sessió després d'obtenir la clau abans de fer l'única operació SQL restringida. No accepta un `userId`, `role` o subjecte de navegador com a proves de privilegi.
- `tests/whatsapp-signed-atomic-consent-client.test.js`: 9 proves unitàries negatives i positives del client signat.
- `tests/whatsapp-signed-atomic-activation.test.cjs`: PostgreSQL real efímer amb una connexió `SET ROLE` de runtime restringit; assegura impossibilitat de fer SQL directe, signatura vàlida, denegació per família equivocada, replay, rol/secret revocat, alta simultània, rollback per fallada artificial després de crear autorització i **recorregut complet client JS → funció SQL**.

## Resultat comprovat

[GitHub Actions #42922037989](https://github.com/DavidParet/Primer-projecte/actions/runs/42922037989): **SUCCESS**, commit `603b9a2`, amb 9/9 proves de l'adaptador i la prova PostgreSQL restringida superades, a més de les regressions de l'entrada duradora i pairing preexistents.

## Limitacions de seguretat abans d'una beta

1. **No hi ha IdP/usuari real.** El `bindVerifiedRequest` de CI és sintètic. La connexió amb sessió Neon Auth real, sessió revocable, família propietària i permisos de rol no està aprovada ni desplegada.
2. **Enllaç amb el model canònic de membres real encara pendent:** el permís HMAC ja incorpora `user_id`; la funció CI comprova `owner/admin`, `active` i absència de revocació dins de la mateixa transacció amb `FOR SHARE`. **Però ho fa sobre `nex_ci_atomic_membership_fixture`, una rèplica sintètica del model de pertinences, no sobre `nex_family_memberships` real ni sobre una sessió IdP de producció.** Falta integrar la funció d'autorització canònica real i una estratègia de rols/locks revisada, sense exposar als comptes de runtime cap privilegi que permeti modificar pertinences.
3. **Falten els dos emissors d'evidències reals:** el receptor Meta només hauria de gravar la prova després de verificar la signatura HMAC RAW de l'esdeveniment i vincular el repte, família i telèfon. El web només hauria de generar un rebut explícit després de validar una sessió familiar autèntica i registrar l'acceptació. Els tests avui fan aquestes insercions com a superusuari de CI per provar el contracte, **no demostren que un emissor real sigui segur**.
4. **Claus i privilegis de Neon pendents:** els objectes de SQL i els rols `nex_ci_*` estan pensats per proves efímeres, no es poden aplicar directament a una branca de producció. Cal aprovar credencials separades, rotació de claus, revisió del secret històric de Vercel, grants mínims, rollback de la migració, RLS, auditories i seguiment.
5. **Retenció i minimització:** no s'ha activat la supressió periòdica dels justificants, nonces i missatges. Cal revisar protecció de dades personals de tercers i menors i les limitacions de reenviaments, reintents i quarantena de Meta.
6. **No hi ha endpoint Meta en viu ni alta en UI:** el webhook POST de producció continua sense activació d'ingestió real. El prototip no pot accedir automàticament a converses privades/grups existents.

**Guàrdia de llançament:** NO MERGE / NO NEON MIGRATION / NO META ACTIVATION. La CI valida només la frontera criptogràfica i el rol limitat del prototip. La pròxima tasca tècnica és integrar l'autorització canònica actual **dins la funció SQL signada**, després fer els emissors verificats i l'E2E de preview.


## Novetat validada: revocació realment bloquejada a PostgreSQL (11 novembre 2026)

**GitHub Actions [#42925775895](https://github.com/DavidParet/Primer-projecte/actions/runs/42925775895): SUCCESS**. Commit `5271326`; Node, Meta pairing regressions, PostgreSQL concurrent tests i prova de funció signada han passat.

- `lib/whatsapp/signed-atomic-consent-client.js`: signatura HMAC de l'ID canònic d'administrador obtingut de `getVerifiedPrincipal()`. No prové de formularis.
- `db/migrations/20261111_whatsapp_signed_atomic_activation_ci.sql`: taula de membres **exclusivament CI** amb permisos `owner/admin/member`, `active`, `revoked_at`. El rol SQL de la funció només pot consultar i adquirir bloqueig `FOR SHARE` (disposa de `UPDATE(lock_marker)` sense permís per canviar `role` o `revoked_at`). El runtime públic simulat no pot consultar ni modificar la taula.
- La funció exigeix que el membre signat segueixi sent `owner` o `admin`, actiu i no revocat **després d'haver verificat la signatura i abans de donar cap autorització o consumir justificants**.
- La prova amb dues connexions PostgreSQL bloqueja una modificació de rol d'administrador, llança l'alta mentre l'UPDATE no s'ha confirmat i comprova que l'alta **espera el bloqueig**, veu la pèrdua de permisos després de `COMMIT`, rebutja i no consumeix cap prova. També denega una signatura per un usuari desconegut i una connexió de runtime que intenta editar rols.

**Advertència:** no donar per completada la connexió canònica de NexLupa: la migració i la identitat són només de CI. La següent integració haurà d'usar el model real d'usuaris i pertinences de Neon i permisos segurs, després establir els dos emissors de justificants amb sessió web verificada i signatura Meta. Cap activació en producció.
