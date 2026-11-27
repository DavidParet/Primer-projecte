# Pilot de la quota FREE

La branca `feat/free-quota-server-pilot` exigeix una sessió verificada al desplegament de previsualització. El compte disposa de tres peticions de text per dia de Madrid. El servidor reserva una plaça abans d’enviar la petició a la IA. Un error posterior del proveïdor consumeix la plaça en aquest pilot. Les peticions rebutjades abans de la reserva queden fora del recompte.

## Configuració del pilot

- Reutilitza l’accés per correu i contrasenya del pilot de Neon Auth, amb comptes de prova autoritzats.
- Aplica `db/migrations/20261127_free_daily_usage.sql` a la base de proves. Concedeix `USAGE` sobre `nexlupa_quota` i `SELECT, INSERT, UPDATE` sobre `nexlupa_quota.daily_text_usage` al rol d’aplicació del pilot.
- Configura per a la branca de proves `NEXLUPA_AUTH_PILOT=enabled`, `NEXLUPA_AUTH_BASE_URL`, `NEXLUPA_AUTH_PILOT_ORIGIN`, `NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS` i `NEXLUPA_FREE_QUOTA_DB_URL`. El domini de la previsualització ha de coincidir amb l’origen autoritzat al servei d’autenticació.
- Entra a `/app/`. Des de «Inicia sessió», accedeix amb un compte de prova i torna a l’app. Prova quatre textos ficticis des del mateix compte, canvia de navegador i comprova que la quarta petició rep 429. Amb un segon compte, comprova que la primera petició continua disponible.

La quota operativa per a clients requereix integrar aquest control al flux d’autenticació que es decideixi per al llançament.
