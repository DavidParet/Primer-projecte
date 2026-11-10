'use strict';

/**
 * Ephemeral, human-review-only inbox used for the synthetic Gmail pilot.
 * It never contacts Google, Neon, Calendar or any AI. It does not persist
 * across serverless invocations. Do not use it as a durable production inbox.
 * All input must come from the server-generated preview, never request JSON.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256=/^[0-9a-f]{64}$/;
const MONTHS='gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre';
const DATE=new RegExp('\\b(?:el dia|abans del)\\s+([0-3]?\\d)\\s+de\\s+('+MONTHS+')\\b','i');
const MAX_PER_PREVIEW=3;
const MAX_PER_FAMILY=50;

function identity(session) {
  if(session?.kind!=='family-session'||session.verifiedByServer!==true||
     typeof session.familyId!=='string'||!UUID.test(session.familyId)||
     typeof session.authUserId!=='string'||!UUID.test(session.authUserId)||
     typeof session.sessionId!=='string'||session.sessionId.length<10)
    throw new Error('family_auth_required');
  return {familyId:session.familyId.toLowerCase(),authUserId:session.authUserId.toLowerCase()};
}
function validText(value,limit) {
  return typeof value==='string' && value.length<=limit &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function rowFromDraft(draft) {
  if(!draft||Array.isArray(draft)||typeof draft!=='object'||
    draft.source!=='gmail'||draft.status!=='pending_review'||
    draft.hasBeenAnalyzedByAI!==false||draft.trustedInstructions!==false||
    typeof draft.sourceEventHash!=='string'||!SHA256.test(draft.sourceEventHash)||
    !validText(draft.title,300)||!validText(draft.from,320)||
    !validText(draft.bodyExcerpt,600))
    throw new Error('invalid_review_draft');
  const words=(draft.title+' '+draft.bodyExcerpt).toLocaleLowerCase('ca');
  const category=/\b(pagament|pagar|quota|factura)\b/u.test(words)?'payment':
    /\b(sortida|excursió|excursio|colònies|colonies)\b/u.test(words)?'school_event':'message';
  const match=DATE.exec(words);
  const dateText=match?match[0]:null;
  return {
    sourceEventHash:draft.sourceEventHash,
    source:'gmail',title:draft.title,from:draft.from,bodyExcerpt:draft.bodyExcerpt,
    category,dateText,dateNeedsReview:dateText!==null,
    status:'pending_review',trustedInstructions:false
  };
}
function assertPreview(preview,familyId) {
  if(!preview||typeof preview!=='object'||Array.isArray(preview)||
     preview.status!=='preview_only'||typeof preview.familyId!=='string'||
     preview.familyId.toLowerCase()!==familyId||
     !Array.isArray(preview.drafts)||preview.drafts.length>MAX_PER_PREVIEW||
     !Number.isInteger(preview.reviewedMessages)||
     preview.reviewedMessages!==preview.drafts.length||
     !preview.sideEffects||typeof preview.sideEffects!=='object'||
     ['databaseWrites','gmailWrites','calendarWrites','aiCalls']
       .some(key=>preview.sideEffects[key]!==false))
    throw new Error('invalid_review_preview');
  return preview.drafts.map(rowFromDraft);
}
function createEphemeralReviewBoard() {
  const families=new Map();
  async function authorized(familySession,checkCurrentFamilyConsent) {
    const id=identity(familySession);
    if(typeof checkCurrentFamilyConsent!=='function')
      throw new Error('secure_consent_checker_required');
    if(await checkCurrentFamilyConsent(id)!==true)
      throw new Error('gmail_consent_revoked');
    return id;
  }
  return {
    async ingest({familySession,preview,checkCurrentFamilyConsent}) {
      const id=await authorized(familySession,checkCurrentFamilyConsent);
      const rows=assertPreview(preview,id.familyId);
      const records=families.get(id.familyId)||new Map();
      // Validate entire input before changing state (no partial import).
      const unique=new Map();
      for(const row of rows) {
        const existing=unique.get(row.sourceEventHash)||records.get(row.sourceEventHash);
        if(existing) {
          const comparable=({status,...value})=>value;
          if(JSON.stringify(comparable(existing))!==JSON.stringify(comparable(row)))
            throw new Error('conflicting_source_event');
        }
        unique.set(row.sourceEventHash,row);
      }
      let added=0;
      for(const key of unique.keys()) if(!records.has(key)) added++;
      if(records.size+added>MAX_PER_FAMILY) throw new Error('review_board_limit');
      // Second check closes the gap created by async validation.
      await authorized(familySession,checkCurrentFamilyConsent);
      for(const [key,row] of unique) if(!records.has(key)) records.set(key,row);
      families.set(id.familyId,records);
      return {added,duplicates:rows.length-added,total:records.size,mode:'ephemeral_review_only'};
    },
    async list({familySession,checkCurrentFamilyConsent}) {
      const id=await authorized(familySession,checkCurrentFamilyConsent);
      const rows=families.get(id.familyId);
      return rows?Array.from(rows.values(),row=>({...row})):[];
    },
    async decide({familySession,sourceEventHash,decision,checkCurrentFamilyConsent}) {
      const id=await authorized(familySession,checkCurrentFamilyConsent);
      if(typeof sourceEventHash!=='string'||!SHA256.test(sourceEventHash)||
         !['reviewed','dismissed'].includes(decision))
        throw new Error('invalid_review_decision');
      const row=families.get(id.familyId)?.get(sourceEventHash);
      if(!row) throw new Error('review_item_not_found');
      // No network call or real-world action is performed by this decision.
      row.status=decision;
      return {...row};
    }
  };
}
module.exports={createEphemeralReviewBoard};
