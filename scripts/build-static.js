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
