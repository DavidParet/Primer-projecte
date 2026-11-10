# NexLupa · WhatsApp signed atomic consent (11-11-2026)

**Estat: PR #15 DRAFT, només codi intern i proves amb dades sintètiques.** 
**Prohibit connectar aquest conjunt de fitxers a endpoints públics, Meta/Neon reals o producció sense la revisió i l'E2E pendents.**

## Resum tècnic actual — comprovacions confirmades

- [GitHub Actions #42926543870](https://github.com/DavidParet/Primer-projecte/actions/runs/42926543870): **SUCCESS**. Ja no existeix una taula paral·lela de membres dins del nou circuit signat. S'instal·la l'**esquema canònic TTP240** `db/migrations/20261109_nexlupa_canonical_identity_staged.sql` en PostgreSQL 16 efímer.
- [GitHub Actions #42926884477](https://github.com/DavidParet/Primer-projecte/actions/runs/42926884477): **SUCCESS**. Set proves del nou adaptador `lib/whatsapp/pilot-atomic-consent.js`: sessió pilot HttpOnly, Neon Auth server-verifier simulat, resolució d'identitat i rol familiar canònic, destí Meta oficial, request CSRF/origen i peticions SQL restringides.
- [GitHub Actions #42927232364](https://github.com/DavidParet/Primer-projecte/actions/runs/42927232364): **SUCCESS**. Recorrregut integrat de preview **simulat externament** però amb PostgreSQL real per a identitat, família, comprovació de membres, funció signada i escriptura transaccional. Una revocació de `nex_idp_identity_links` invalida l'alta, tot i que es reutilitzi la mateixa galeta sintètica.

### Cadena de confiança implementada en proves

1. **BFF preview:** `createPilotAtomicConsentFactory` només admet la configuració explícita `VERCEL_ENV=preview` més les portes pilot; obliga a host, origen HTTPS, POST, galeta `__Host-` i allowlist de subjects. L'usuari, el seu rol, el número Meta i la versió de consentiment no s'obtenen del JSON del navegador.
2. **Identitat canònica:** el backend simula consultar el servidor Neon Auth en cada comprovació i resol l'emissor/subjècte verificats a `nex_users` i `nex_idp_identity_links` per un rol lector de funcions SQL. `nex_family_memberships` es comprova via `nex_ci_active_family_membership`; cap rol de navegador esdevé administrador.
3. **Permís signat:** `lib/whatsapp/signed-atomic-consent-client.js` utilitza una clau HMAC d'activació separada de les de prova de telèfon i rebut. Signa ID canònic d'usuari, família, destí WABA/número, dos digests de justificants, versió, nonce i caducitat de **45 segons**; comprova de nou sessió i rol després de carregar la clau.
4. **SQL atòmic restringit:** `db/migrations/20261111_whatsapp_signed_atomic_activation_ci.sql` és un **fixture NO APTE PER A NEON** que crea dos rols `NOBYPASSRLS`; només el runtime limitat pot executar la funció signada `nex_ci_signed_activate_atomic_consent`. El propietari de la funció té `EXECUTE`, però **no permisos directes d'escriptura sobre pertinences**, a la funció canònica `nex_ci_authorize_canonical_family_locked`.
5. **Bloqueig de membre i alta:** la funció canònica, executada dins de la mateixa transacció, bloqueja la fila de `nex_family_memberships` amb `FOR SHARE OF m`. Rebutja membres ordinaris, comptes desactivats, famílies arxivades, rols suspesos i membres revocats. Després es bloquegen prova i rebut, es valida que coincideixin amb la família i el remitent i es crea una única autorització; es consumeixen tots dos justificants i el nonce **atòmicament**. Error després de la inserció = `ROLLBACK`, sense alta ni justificants consumits.
6. **Concurrència negativa:** proves amb dues connexions confirmen que una revocació de membre que es confirma primer fa esperar i denegar l'alta, que una autorització no es pot repetir i que el runtime no pot consultar les taules protegides.

### Limitacions pendents imprescindibles

- **No hi ha IdP Neon Auth real connectat en aquest flux.** El test mockeja la resposta externa de la sessió; els usuaris canònics i les famílies són només els registres de PostgreSQL efímer. L'esquema TTP240 encara no s'ha implantat a Neon.
- **No hi ha cap emissor real de proves de número** vinculat a Meta. El control de signatura RAW de Meta, el repte, les comprovacions WABA/número, la protecció contra duplicats i la vinculació amb el compte familiar encara s'han d'integrar i auditar.
- **No hi ha emissor real de rebut explícit del web.** L'usuari pilot ha d'acceptar explícitament el consentiment; s'ha de guardar un rebut vinculat a l'evidència telefònica, família, versió i sessió autenticada. Els tests insereixen comprovants sintètics amb el superusuari **només per validar la part SQL**.
- **Cap secret real ni rol Neon està aprovat.** Falta pla de migració/reversió en branca Neon aïllada, grants mínims, custòdia i rotació de claus, revisió del token Vercel històric i separació d'emissors/activador; no copiar ni executar els rols `nex_ci_*` en producció.
- **No hi ha WhatsApp HTTP POST ni lectura de grups reals.** Tampoc hi ha UI d'alta ni pilot E2E veritable. Privacy/RGPD, retenció, drets de tercers, menors i operacions d'esborrat/quarantena estan pendents.
- **Vercel:** una validació preview anterior va quedar limitada per la quota de compilacions. La CI de GitHub **no equival** a preview Vercel aprovada ni a disponibilitat de l'aplicació.

### Próxima tasca executable

Preparar **emissors verificats i de permisos mínims** per a prova Meta i rebut web; provar-los amb peticions falses i administradors revocats, i preparar una branca de Neon completament aïllada amb els rols canònics revisats. Només després executar E2E amb un usuari pilot real i Meta en mode prova, sense publicació automàtica.

**Guardrail:** mantenir la [PR #15](https://github.com/DavidParet/Primer-projecte/pull/15) com a esborrany: **NO MERGE / NO NEON LIVE / NO META LIVE / NO PRODUCTION**.

### Històric de proves anteriors

- [#42922037989](https://github.com/DavidParet/Primer-projecte/actions/runs/42922037989): rol SQL de runtime restringit, signatura HMAC, rollback i replay.
- [#42925775895](https://github.com/DavidParet/Primer-projecte/actions/runs/42925775895): primera prova de revocació concurrent sobre una taula de membres CI ara substituïda per l'esquema TTP240.
