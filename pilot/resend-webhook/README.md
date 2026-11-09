# NEXLUPA — isolated Resend webhook transport pilot
Designed only for external signed webhook *transport* validation; no real family message processing.
The one-time API key is NOT present in repository or deployment.
`GET /api/webhook` reports limited status (without secrets).
`POST /api/webhook` accepts ONLY valid Svix HMAC signatures within 5 min,
acknowledges with 204; NO AI, Calendar, outbound emails, attachments, or storage.
No real family emails should be sent to this pilot.
It must run as a **separate Vercel project**, NOT as a route on public NEXLUPA
or on `nexlupa.app`. Configure `RESEND_WEBHOOK_SECRET` as encrypted env,
never inside source. Automatic registration only after endpoint confirmed.
Refer to Resend/agent-email-inbox skill for production sender attestation,
durable queues, consent and encrypted persistence requirements.
