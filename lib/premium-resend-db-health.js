'use strict';
/**
 * Read-only validation that a deployed pilot is talking to the intended
 * isolated Neon schema using the constrained ingestion role.
 *
 * No data rows are read or written. Return only boolean. No secrets, schema,
 * connection strings, or exception text may appear in public responses.
 */
const SQL = `SELECT
  (current_database() = 'nexlupa_pilot')
  AND (current_user = 'nexlupa_resend_ingest')
  AND has_schema_privilege(current_user,'nexlupa_pilot','USAGE')
  AND (to_regclass('nexlupa_pilot.resend_inbox_queue') IS NOT NULL)
  AND has_table_privilege(current_user,'nexlupa_pilot.resend_inbox_queue','SELECT')
  AND has_table_privilege(current_user,'nexlupa_pilot.resend_inbox_queue','INSERT')
  AND has_table_privilege(current_user,'nexlupa_pilot.resend_inbox_queue','UPDATE')
  AND has_table_privilege(current_user,'nexlupa_pilot.resend_inbox_queue','DELETE')
  AND NOT has_database_privilege(current_user,current_database(),'CREATE')
  AS ready`;
async function checkQueueDbHealth(db) {
  if(!db||typeof db.query!=='function')return false;
  try {
    const data=await db.query(SQL);
    return data?.rowCount===1&&
      Array.isArray(data.rows)&&data.rows.length===1&&data.rows[0].ready===true;
  }catch(_err){return false}
}
module.exports={SQL,checkQueueDbHealth};
