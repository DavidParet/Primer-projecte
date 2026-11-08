'use strict';
/**
 * Isolated pilot read-only DB connectivity probe.
 * Returns no query data, connection strings, user identifiers, or error text.
 * Not used by production NEXLUPA and does not inspect incoming email.
 */
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){
    res.statusCode=405;res.end(JSON.stringify({ready:false}));return;
  }
  if(!process.env.DATABASE_URL){
    res.statusCode=503;res.end(JSON.stringify({ready:false}));return;
  }
  let client;
  try {
    const {Client}=require('pg');
    client=new Client({
      connectionString:process.env.DATABASE_URL,
      ssl:{rejectUnauthorized:true},
      connectionTimeoutMillis:4000,
      query_timeout:4000
    });
    await client.connect();
    const result=await client.query('SELECT 1 AS ok');
    if(result.rowCount!==1||result.rows[0].ok!==1)
      throw Error('DB_PING_MISMATCH');
    res.statusCode=200;res.end(JSON.stringify({ready:true,scope:'isolated-db-only'}));
  }catch(_err){
    res.statusCode=503;res.end(JSON.stringify({ready:false}));
  }finally{
    if(client)try{await client.end()}catch(_err){}
  }
};
