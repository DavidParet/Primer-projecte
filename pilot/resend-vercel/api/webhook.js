/**
 * Resend inbound webhook — LOCKED FAIL-CLOSED SCAFFOLD, not a live inbox.
 *
 * Deliberately does not ACK email.received until durable encrypted storage,
 * tenant identity and sender authentication are implemented and tested.
 * Never log raw payloads, sender data or credentials.
 *
 * Once enabled for an isolated test:
 *  - inspect raw body using Request.text() (no JSON re-serialization)
 *  - verify Resend signature BEFORE trusting event metadata
 *  - return 503 for inbound until durable acceptance is implemented
 *  - do NOT create calendar events or modify live family activity cards
 */
const json=(body,status,headers={})=>Response.json(body,{status,headers:{
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  ...headers
}});
const unavailable=()=>json({status:'locked',accepted:false},503,{'Retry-After':'300'});

export async function POST(request) {
  // Do not consume untrusted data while the pilot is disabled.
  if(process.env.RESEND_PILOT_ENABLED!=='true')return unavailable();
  const apiKey=process.env.RESEND_API_KEY;
  const secret=process.env.RESEND_WEBHOOK_SECRET;
  if(typeof apiKey!=='string'||!apiKey.startsWith('re_')||
     typeof secret!=='string'||!secret.startsWith('whsec_'))
    return unavailable();

  const id=request.headers.get('svix-id');
  const timestamp=request.headers.get('svix-timestamp');
  const signature=request.headers.get('svix-signature');
  if(!id||!timestamp||!signature)return json({error:'invalid_signature'},401);
  const sizeHeader=Number(request.headers.get('content-length')||0);
  if(!Number.isFinite(sizeHeader)||sizeHeader>65536)
    return json({error:'payload_too_large'},413);

  let payload;
  try{payload=await request.text()}catch(_err){return json({error:'invalid_body'},400)}
  if(payload.length>65536)return json({error:'payload_too_large'},413);
  let event;
  try{
    const {Resend}=await import('resend');
    const resend=new Resend(apiKey);
    event=resend.webhooks.verify({
      payload,headers:{id,timestamp,signature},webhookSecret:secret
    });
  }catch(_err){return json({error:'invalid_signature'},401)}
  if(event?.type!=='email.received')
    return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});

  // Never ACK email.received without durable, encrypted, idempotent queue.
  // A 503 lets the delivery service retry if a webhook is ever registered.
  return json({status:'queue_not_configured',accepted:false},503,{
    'Retry-After':'300'
  });
}
