'use strict';
/**
 * Isolated public entrypoint for the opt-in forwarding pilot.
 * No dependency on the protected NexLupa application.
 * Inbound processing is OFF unless a deliberately scoped flag is enabled.
 */
const {createRuntimeHandler}=require('../lib/runtime.cjs');
module.exports=createRuntimeHandler();
module.exports.config={api:{bodyParser:false}};
