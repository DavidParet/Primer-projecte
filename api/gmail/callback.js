'use strict';
const { getRuntime }=require('../../lib/gmail/runtime.cjs');
const { clearCookie }=require('../../lib/gmail/cookie-session.cjs');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Set-Cookie',clearCookie());
  try { const handlers=await getRuntime();return handlers.callback(req,res); }
  catch { return res.status(503).send('La connexió de Gmail no està activada.'); }
};
