'use strict';
// Vercel Node Serverless Function, separate from the existing stable Resend
// webhook. No real events are routed here until explicitly configured.
const {createRuntimeHandler}=require('../../lib/forwarding/runtime.cjs');

module.exports=createRuntimeHandler();
// Require original bytes for Svix HMAC verification. Never use req.body (JSON).
module.exports.config={api:{bodyParser:false}};
