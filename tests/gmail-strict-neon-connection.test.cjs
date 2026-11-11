'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { strictPilotConnectionString } = require('../lib/gmail/strict-neon-connection.cjs');
const base='postgresql://nexlupa_gmail_auth_preview:only-a-test-password@ep-sample.eu-central-1.aws.neon.tech/nexlupa_pilot?sslmode=require';

test('pins verify-full TLS and keeps the exact test role',()=>{
  const u=new URL(strictPilotConnectionString(base));
  assert.equal(u.searchParams.get('sslmode'),'verify-full');
  assert.equal(u.username,'nexlupa_gmail_auth_preview');
  assert.equal(u.pathname,'/nexlupa_pilot');
  assert.equal(u.hostname,'ep-sample.eu-central-1.aws.neon.tech');
});
test('does not lose other valid Neon connection arguments',()=>{
  const u=new URL(strictPilotConnectionString(base+'&channel_binding=require'));
  assert.equal(u.searchParams.get('channel_binding'),'require');
  assert.equal(u.searchParams.get('sslmode'),'verify-full');
});
test('accepts already strict verify-full',()=>{
  assert.equal(new URL(strictPilotConnectionString(base.replace('sslmode=require','sslmode=verify-full'))).searchParams.get('sslmode'),'verify-full');
});
test('forces strict TLS even when SSL mode is omitted',()=>{
  const u=new URL(strictPilotConnectionString(base.replace('?sslmode=require','')));
  assert.equal(u.searchParams.get('sslmode'),'verify-full');
});
test('refuses an untrusted host',()=>{
  assert.throws(()=>strictPilotConnectionString(base.replace('ep-sample.eu-central-1.aws.neon.tech','attacker.example')),/invalid_pilot_database_configuration/);
});
test('refuses lookalike Neon domains',()=>{
  assert.throws(()=>strictPilotConnectionString(base.replace('aws.neon.tech','aws.neon.tech.evil.example')),/invalid_pilot_database_configuration/);
});
test('refuses a privileged account',()=>{
  assert.throws(()=>strictPilotConnectionString(base.replace('nexlupa_gmail_auth_preview','neondb_owner')),/invalid_pilot_database_configuration/);
});
test('refuses production or unrelated database',()=>{
  assert.throws(()=>strictPilotConnectionString(base.replace('nexlupa_pilot?','neondb?')),/invalid_pilot_database_configuration/);
});
test('rejects SSL downgrade',()=>{
  for(const mode of ['disable','allow','prefer','verify-ca']){
    assert.throws(()=>strictPilotConnectionString(base.replace('sslmode=require','sslmode='+mode)),/invalid_pilot_database_configuration/);
  }
});
test('refuses custom certificate paths or libpq compatibility flags',()=>{
  for(const frag of ['&sslrootcert=/tmp/untrusted.crt','&sslkey=/tmp/key','&uselibpqcompat=true']){
    assert.throws(()=>strictPilotConnectionString(base+frag),/invalid_pilot_database_configuration/);
  }
});
test('refuses blank password, userinfo fragment and non-Postgres scheme',()=>{
  assert.throws(()=>strictPilotConnectionString(base.replace(':only-a-test-password@',':@')),/invalid_pilot_database_configuration/);
  assert.throws(()=>strictPilotConnectionString(base+'#fragment'),/invalid_pilot_database_configuration/);
  assert.throws(()=>strictPilotConnectionString(base.replace('postgresql://','https://')),/invalid_pilot_database_configuration/);
});
test('never echoes credentials in an invalid-connection error',()=>{
  const secret='super-secret-nexlupa-test-string';
  assert.throws(()=>strictPilotConnectionString(base.replace('ep-sample.eu-central-1.aws.neon.tech','attacker.example').replace('only-a-test-password',secret)),err=>{
    assert.ok(!err.message.includes(secret));
    return err.message==='invalid_pilot_database_configuration';
  });
});
