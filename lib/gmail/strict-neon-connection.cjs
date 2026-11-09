'use strict';

/**
 * Accept only the dedicated NexLupa test-branch Neon role, database and a
 * certificate/hostname verified connection. Do not log the returned URL.
 * Connection URLs are read only from encrypted server environment variables.
 */
function strictPilotConnectionString(value) {
  if (typeof value !== 'string' || value.length < 55 || value.length > 4096) {
    throw new Error('invalid_pilot_database_configuration');
  }
  let uri;
  try { uri = new URL(value); }
  catch { throw new Error('invalid_pilot_database_configuration'); }

  const role = decodeURIComponent(uri.username);
  const db = decodeURIComponent(uri.pathname.replace(/^\//, ''));
  if (!['postgresql:', 'postgres:'].includes(uri.protocol) ||
      !uri.hostname.endsWith('.neon.tech') ||
      !/^[a-z0-9.-]+$/.test(uri.hostname) ||
      !uri.password || uri.hash ||
      role !== 'nexlupa_gmail_auth_preview' ||
      db !== 'nexlupa_pilot' ||
      (uri.port && uri.port !== '5432')) {
    throw new Error('invalid_pilot_database_configuration');
  }
  // pg v8 treats sslmode=require as verify-full, but later major versions may
  // loosen it. Explicitly pin certificate + host verification now.
  const forbidden = ['sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'sslaccept', 'uselibpqcompat'];
  if (forbidden.some(name => uri.searchParams.has(name))) {
    throw new Error('invalid_pilot_database_configuration');
  }
  const oldMode = uri.searchParams.get('sslmode');
  if (oldMode && oldMode !== 'require' && oldMode !== 'verify-full') {
    throw new Error('invalid_pilot_database_configuration');
  }
  uri.searchParams.set('sslmode', 'verify-full');
  return uri.toString();
}

module.exports = { strictPilotConnectionString };
