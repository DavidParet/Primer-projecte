#!/usr/bin/env node
'use strict';

/**
 * Emit ONLY the public website assets.
 * Never publish docs/, tests/, .claude/, .github/, source scripts, or API source.
 * The /api functions remain at the repository root for Vercel's Node runtime.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const files = [
  'index.html',
  'style.css',
  'script.js',
  'hero.png',
  'app/index.html',
  'app/script.js',
  'app/style.css',
  'app/assets/logo-white.png',
  'app/assets/nexlupa-logo-dark.png',
  'app/assets/nexlupa-logo-light.png',
  'landing/index.html',
  'landing/script.js',
  'landing/style.css',
  'landing/hero.png'
];

// The authentication preview must NOT appear on production web builds.
// Activation requires a nonproduction Vercel deployment and an EXACT,
// operator-provisioned *.vercel.app origin. No domain guesses or wildcards.
function pilotPreviewAllowed(env = process.env) {
  if(env.VERCEL_ENV !== 'preview' ||
     env.NEXLUPA_AUTH_PILOT !== 'enabled')return false;
  try{
    const u=new URL(env.NEXLUPA_AUTH_PILOT_ORIGIN);
    const auth=new URL(env.NEXLUPA_AUTH_BASE_URL);
    const subjects=env.NEXLUPA_AUTH_PILOT_ALLOWED_SUBJECTS;
    if(typeof subjects!=='string' || subjects.length<8 ||
       subjects.length>8192)return false;
    const entries=subjects.split(',').map(value=>value.trim());
    if(entries.length>50 ||
       entries.some(value=>!/^[A-Za-z0-9_-]{8,128}$/.test(value)) ||
       new Set(entries).size!==entries.length)return false;
    // The site must not include even the preview login UI when the
    // matching server-side Neon Auth/allowlist guard cannot initialize.
    return u.protocol==='https:' && u.hostname.endsWith('.vercel.app') &&
      u.hostname!=='vercel.app' && u.pathname==='/' &&
      !u.port && !u.search && !u.hash && !u.username && !u.password &&
      auth.protocol==='https:' && auth.hostname.startsWith('ep-') &&
      auth.hostname.includes('.neonauth.') &&
      auth.hostname.endsWith('.aws.neon.tech') &&
      /^\/[A-Za-z0-9_-]{1,63}\/auth$/.test(auth.pathname) &&
      !auth.port && !auth.search && !auth.hash &&
      !auth.username && !auth.password;
  }catch{return false;}
}
if(pilotPreviewAllowed()) {
  files.push('pilot-auth/index.html','pilot-auth/script.js');
}

fs.rmSync(output, { recursive: true, force: true });
for (const relative of files) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error('Missing required public asset: ' + relative);
  }
  const destination = path.join(output, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
console.log('Static release: copied ' + files.length + ' allowlisted assets into public/');
