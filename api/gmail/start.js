'use strict';
const { getRuntime }=require('../../lib/gmail/runtime.cjs');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('Referrer-Policy','no-referrer');
  try { const handlers=await getRuntime();return handlers.start(req,res); }
  catch { return res.status(503).json({ready:false,error:'gmail_pilot_unavailable'}); }
};
