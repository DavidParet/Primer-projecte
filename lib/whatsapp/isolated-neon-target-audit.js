'use strict';

/**
 * Offline metadata-only gate for NexLupa's WhatsApp preview database.
 *
 * Deliberately accepts neither a connection string nor SQL statements:
 * this module NEVER creates a branch, opens a DB, or approves deployment.
 * A Neon branch ordinarily copies parent DATA. Names are not evidence
 * that its schema, secrets or users are isolated.
 */
const SAFE_IDENTIFIER=/^[a-z0-9-]{3,80}$/;
const SANDBOX_PROJECT=/^nexlupa-whatsapp-consent-sandbox-[a-z0-9-]{6,48}$/;
const PREVIEW_BRANCH=/^whatsapp-consent-preview-[0-9]{8}$/;
const ALLOWED_SCHEMAS=new Set(['pg_catalog','information_schema']);
const CHECKS=Object.freeze([
 'dedicated_sandbox_project',
 'non_default_preview_branch',
 'parent_branch_empty_independently_verified',
 'no_business_tables',
 'independent_empty_database_attestation',
 'restricted_runtime_roles_reviewed',
 'real_provider_data_excluded',
 'explicit_operator_approval'
]);
function auditIsolatedNeonTarget(snapshot){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
  throw new TypeError('Explicit isolated-target metadata snapshot required');
 const {project,branch,tables,attestations}=snapshot;
 if(!project||typeof project!=='object'||
    !branch||typeof branch!=='object'||!Array.isArray(tables))
  throw new TypeError('Project, branch and complete table inventory required');
 // Accept ONLY metadata. SQL connection URLs/passwords are never read or
 // emitted by this preflight tool.
 const failures=[];
 if(typeof project.id!=='string'||!SAFE_IDENTIFIER.test(project.id)||
    !SANDBOX_PROJECT.test(project.name||''))
  failures.push('project_not_dedicated_whatsapp_sandbox');
 // Neon metadata MUST tie the branch to this exact dedicated project.
 // Matching names or a separately supplied project record are not enough:
 // a caller can otherwise accidentally combine sandbox project metadata
 // with a branch belonging to a real NexLupa database.
 if(typeof branch.project_id!=='string'||
    branch.project_id!==project.id)
  failures.push('branch_project_mismatch');
 if(typeof branch.id!=='string'||!branch.id.startsWith('br-')||
    !SAFE_IDENTIFIER.test(branch.id)||
    !PREVIEW_BRANCH.test(branch.name||'')||
    branch.primary!==false||branch.default!==false)
  failures.push('preview_branch_identity_or_default_unsafe');
 // Most Neon branches inherit their parent's DATA. A separate, freshly
 // created sandbox project can use an empty parent; a copied branch must be
 // independently attested empty. Neither a name nor zero listed tables
 // proves that existing credentials or rows were never copied.
 const att=attestations&&typeof attestations==='object'?
   attestations:{};
 const parentClone=Boolean(branch.parent_id)||
   branch.init_source==='parent-data';
 const validSource=['empty','project-empty-template','parent-data']
   .includes(branch.init_source);
 if(!validSource||
   (parentClone && (!branch.parent_id||
    branch.init_source!=='parent-data'||
    att.parent_branch_empty_verified!==true)))
  failures.push('parent_data_copy_not_excluded');
 if(snapshot.tableInventoryComplete!==true)
  failures.push('table_inventory_not_confirmed_complete');
 if(tables.some(t=>!t||typeof t.table_schema!=='string'||
    typeof t.table_name!=='string'||!ALLOWED_SCHEMAS.has(t.table_schema)))
  failures.push('existing_application_or_identity_tables_present');
 for(const name of ['independent_empty_database_attestation',
  'restricted_runtime_roles_reviewed','real_provider_data_excluded',
  'explicit_operator_approval']){
  if(att[name]!==true)failures.push(name+'_pending');
 }
 // Even an apparently clean snapshot is NOT a production / migration GO.
 // Checklists are not cryptographic proof of isolation.
 return Object.freeze({
  status:failures.length?'blocked':'independent_review_required',
  structuralReviewOnly:true,
  migrationApproved:false,
  productionApproved:false,
  safeToExecuteSQL:false,
  failedChecks:Object.freeze(failures),
  checks:Object.freeze([...CHECKS]),
  reason:failures.length?
    'No Neon mutation; metadata gate not satisfied':
    'Metadata appears suitable; human verification and explicit authorization remain mandatory'
 });
}
module.exports={auditIsolatedNeonTarget,CHECKS};
