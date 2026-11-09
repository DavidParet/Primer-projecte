'use strict';

// Public-facing request validation for the ONLY supported Gmail OAuth start route.
// These checks are defense in depth, not a substitute for signed Neon Auth JWT
// verification and active family membership in the private backend.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validatePilotStartRequest(req, trustedOrigin) {
  if (req?.method !== 'POST') return {ok:false,status:405,error:'method_not_allowed'};
  let trustedHost;
  try {
    const u = new URL(trustedOrigin);
    if (u.protocol!=='https:' || u.username || u.password || u.search || u.hash || u.pathname!=='/')
      throw Error('invalid');
    trustedHost=u.host.toLowerCase();
  } catch { return {ok:false,status:503,error:'pilot_not_configured'}; }

  const h=req.headers || {};
  if (h.origin!==trustedOrigin || typeof h.host!=='string' || h.host.toLowerCase()!==trustedHost)
    return {ok:false,status:403,error:'origin_not_allowed'};
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(h['content-type'] || ''))
    return {ok:false,status:415,error:'json_content_type_required'};
  const len=Number(h['content-length'] ?? 0);
  if (!Number.isSafeInteger(len) || len<0 || len>512)
    return {ok:false,status:413,error:'invalid_request_size'};
  if (!req.body || Array.isArray(req.body) || typeof req.body!=='object' ||
      Object.keys(req.body).length!==1 ||
      typeof req.body.familyId!=='string' || !UUID.test(req.body.familyId))
    return {ok:false,status:400,error:'invalid_family_selection'};
  const authorization=h.authorization;
  if (typeof authorization!=='string' ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) ||
      authorization.length>8192)
    return {ok:false,status:401,error:'authentication_required'};
  return {ok:true,familyId:req.body.familyId.toLowerCase()};
}
module.exports={validatePilotStartRequest};
