'use strict';

/**
 * Vercel API handler: non-production-preview ONLY.
 * In production, staging branches without explicit settings, and locally,
 * the handler returns 404. It neither registers users nor modifies families.
 */
const {createPilotAuthHandler}=
  require('../lib/whatsapp/pilot-auth-bff');

module.exports=createPilotAuthHandler();
