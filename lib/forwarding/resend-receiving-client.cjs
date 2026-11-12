'use strict';

/**
 * Resend Receiving API read-only adapter for a human-reviewed pilot.
 * Must only be invoked through review-gate AFTER verified family consent.
 *
 * Security properties: static HTTPS host and GET-only path, canonical email ID,
 * redirect refusal, bounded JSON response, no attachment downloads, no retries,
 * no logging or persistence of email bodies, and a reduced return shape.
 *
 * Official endpoint: GET https://api.resend.com/emails/receiving/{email_id}
 */
const {TextDecoder}=require('node:util');

const EMAIL_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_KEY=/^re_[a-zA-Z0-9_-]{12,200}$/;
const MAX_RESPONSE_BYTES=131072;
const API_ORIGIN='https://api.resend.com';

async function boundedJson(response){
  const len=response?.headers?.get?.('content-length');
  if(len!=null && (!/^\d+$/.test(len)||Number(len)>MAX_RESPONSE_BYTES))
    throw Error('response_oversized');
  if(!response?.body || typeof response.body[Symbol.asyncIterator]!=='function')
    throw Error('missing_response_stream');
  let total=0;
  const chunks=[];
  for await (const part of response.body){
    const chunk=Buffer.from(part);
    total+=chunk.length;
    if(total>MAX_RESPONSE_BYTES)throw Error('response_oversized');
    chunks.push(chunk);
  }
  if(!total)throw Error('empty_response');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true})
    .decode(Buffer.concat(chunks)));
}

function createReceivingClient({apiKey,fetchImpl=fetch,timeoutMs=4000}={}){
  if(typeof apiKey!=='string'||!API_KEY.test(apiKey)||
     typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||
     timeoutMs<250||timeoutMs>10000)
    throw Error('receiving_client_not_configured');

  async function fetchReceivedEmail(emailId){
    if(typeof emailId!=='string'||!EMAIL_ID.test(emailId))
      return {error:{code:'invalid_email_id'}};
    let response;
    try{
      response=await fetchImpl(API_ORIGIN+'/emails/receiving/'+emailId,{
        method:'GET',
        redirect:'error',
        cache:'no-store',
        credentials:'omit',
        signal:AbortSignal.timeout(timeoutMs),
        headers:{
          Authorization:'Bearer '+apiKey,
          Accept:'application/json'
        }
      });
      if(!response || response.status!==200 ||
         !/^application\/json(?:;|$)/i.test(response.headers?.get?.('content-type')||''))
        return {error:{code:'provider_unavailable'}};
      const raw=await boundedJson(response);
      const record=raw?.data && typeof raw.data==='object'?raw.data:raw;
      if(!record || typeof record!=='object'||Array.isArray(record))
        return {error:{code:'invalid_provider_payload'}};
      const id=record.id||record.email_id;
      // Provider mismatch: never expose another message's data to this family.
      if(id!==emailId || typeof record.from!=='string' ||
         !Array.isArray(record.to) || typeof record.subject!=='string')
        return {error:{code:'invalid_provider_payload'}};
      const received={
        id,
        from:record.from,
        to:record.to,
        subject:record.subject,
        text:record.text,
        attachments:record.attachments
      };
      // Do not return HTML, raw headers, message_id, reply_to or other fields.
      return {data:received};
    }catch{
      return {error:{code:'provider_unavailable'}};
    }
  }

  return {fetchReceivedEmail};
}

module.exports={createReceivingClient,API_ORIGIN};
