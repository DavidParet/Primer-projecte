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
2. **Comprovació DB actual de membres encara pendent:** el permís HMAC ara vincula família i versió, però la funció restringida CI encara **no verifica a PostgreSQL que l'administrador continuï actiu** després de la signatura. Cal afegir `user_id` al permís signat i consultar amb bloqueig el model canònic de membres de la família dins de la funció, impedint canvis de rol concurrents. Fins llavors no és apte per activar altes reals.
3. **Falten els dos emissors d'evidències reals:** el receptor Meta només hauria de gravar la prova després de verificar la signatura HMAC RAW de l'esdeveniment i vincular el repte, família i telèfon. El web només hauria de generar un rebut explícit després de validar una sessió familiar autèntica i registrar l'acceptació. Els tests avui fan aquestes insercions com a superusuari de CI per provar el contracte, **no demostren que un emissor real sigui segur**.
4. **Claus i privilegis de Neon pendents:** els objectes de SQL i els rols `nex_ci_*` estan pensats per proves efímeres, no es poden aplicar directament a una branca de producció. Cal aprovar credencials separades, rotació de claus, revisió del secret històric de Vercel, grants mínims, rollback de la migració, RLS, auditories i seguiment.
5. **Retenció i minimització:** no s'ha activat la supressió periòdica dels justificants, nonces i missatges. Cal revisar protecció de dades personals de tercers i menors i les limitacions de reenviaments, reintents i quarantena de Meta.
6. **No hi ha endpoint Meta en viu ni alta en UI:** el webhook POST de producció continua sense activació d'ingestió real. El prototip no pot accedir automàticament a converses privades/grups existents.

**Guàrdia de llançament:** NO MERGE / NO NEON MIGRATION / NO META ACTIVATION. La CI valida només la frontera criptogràfica i el rol limitat del prototip. La pròxima tasca tècnica és integrar l'autorització canònica actual **dins la funció SQL signada**, després fer els emissors verificats i l'E2E de preview.
