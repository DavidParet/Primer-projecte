'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {auditIsolatedNeonTarget,CHECKS}=
 require('../lib/whatsapp/isolated-neon-target-audit');

const pristine=()=>({
 project:{id:'silent-purpose-12345678',
  name:'nexlupa-whatsapp-consent-sandbox-ci-20261111'},
 branch:{id:'br-synthetic-123456',
  name:'whatsapp-consent-preview-20261111',
  primary:false,default:false,init_source:'empty'},
 tables:[],tableInventoryComplete:true,
 attestations:{
  independent_empty_database_attestation:true,
  restricted_runtime_roles_reviewed:true,
  real_provider_data_excluded:true,
  explicit_operator_approval:true
 }
});
test('even a claimed empty new sandbox never grants SQL execution or production approval',()=>{
 const result=auditIsolatedNeonTarget(pristine());
 assert.equal(result.status,'independent_review_required');
 assert.equal(result.structuralReviewOnly,true);
 assert.equal(result.migrationApproved,false);
 assert.equal(result.productionApproved,false);
 assert.equal(result.safeToExecuteSQL,false);
 assert.deepEqual(result.failedChecks,[]);
 assert.ok(CHECKS.includes('explicit_operator_approval'));
});
test('real NexLupa pilot and parent-data validation branches fail closed',()=>{
 const cloned=pristine();
 cloned.project.name='nexlupa-resend-pilot';
 cloned.branch.name='whatsapp-auth-pilot-validation-20261109';
 cloned.branch.init_source='parent-data';
 cloned.branch.parent_id='br-an-existing-parent';
 cloned.tables=[
  {table_schema:'neon_auth',table_name:'session'},
  {table_schema:'public',table_name:'nex_whatsapp_sender_authorizations'}
 ];
 const result=auditIsolatedNeonTarget(cloned);
 assert.equal(result.status,'blocked');
 assert.ok(result.failedChecks.includes('project_not_dedicated_whatsapp_sandbox'));
 assert.ok(result.failedChecks.includes('preview_branch_identity_or_default_unsafe'));
 assert.ok(result.failedChecks.includes('parent_data_copy_not_excluded'));
 assert.ok(result.failedChecks.includes('existing_application_or_identity_tables_present'));
});
test('the existing pilot default branch can never be mistaken for a sandbox',()=>{
 const input=pristine();
 input.project.name='nexlupa-resend-pilot';
 input.branch={id:'br-primary-real',name:'pilot',primary:true,default:true,
  init_source:'parent-data'};
 input.tables=[{table_schema:'nexlupa_pilot',table_name:'resend_inbox_queue'}];
 assert.equal(auditIsolatedNeonTarget(input).status,'blocked');
 assert.equal(auditIsolatedNeonTarget(input).safeToExecuteSQL,false);
});
test('metadata gates require a complete table inventory and independent attestations',()=>{
 const input=pristine();
 input.tableInventoryComplete=false;
 delete input.attestations.explicit_operator_approval;
 delete input.attestations.real_provider_data_excluded;
 const out=auditIsolatedNeonTarget(input);
 assert.ok(out.failedChecks.includes('table_inventory_not_confirmed_complete'));
 assert.ok(out.failedChecks.includes('explicit_operator_approval_pending'));
 assert.ok(out.failedChecks.includes('real_provider_data_excluded_pending'));
 assert.equal(out.migrationApproved,false);
});
test('even a preview-named branch is unsafe if it inherits parent data',()=>{
 const input=pristine();
 input.branch.init_source='parent-data';
 input.branch.parent_id='br-parent';
 const out=auditIsolatedNeonTarget(input);
 assert.ok(out.failedChecks.includes('parent_data_copy_not_excluded'));
 assert.equal(out.safeToExecuteSQL,false);
});
test('malformed input, private schemas and unknown columns never grant approval',()=>{
 for(const bad of [null,[],{}, {project:{},branch:{},tables:'[]'}]){
  assert.throws(()=>auditIsolatedNeonTarget(bad),TypeError);
 }
 for(const table of [
  {table_schema:'public',table_name:'users'},
  {table_schema:'neon_auth',table_name:'session'},
  {table_schema:'nexlupa_pilot',table_name:'resend_inbox_queue'},
  null
 ]){
  const input=pristine();input.tables=[table];
  assert.ok(auditIsolatedNeonTarget(input).failedChecks.includes(
    'existing_application_or_identity_tables_present'));
 }
});
test('database connection strings or secrets are not read or echoed back',()=>{
 const input=pristine();
 const marker='CI_SECRET_NEVER_OUTPUT_THIS_VALUE_20261111';
 input.connectionString='postgresql://'+marker+'@private-host.invalid';
 input.password=marker;
 input.project.password=marker;
 const result=auditIsolatedNeonTarget(input);
 assert.equal(JSON.stringify(result).includes(marker),false);
 assert.equal(result.migrationApproved,false);
});
