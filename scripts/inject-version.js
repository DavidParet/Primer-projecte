#!/usr/bin/env node
/**
 * inject-version.js
 * Replaces all ?v=<anything> in HTML files with the current git commit SHA (first 8 chars).
 * Run automatically by Vercel's buildCommand before each deploy.
 * Source: VERCEL_GIT_COMMIT_SHA env (Vercel build) → falls back to `git rev-parse HEAD` (local).
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rawSha = process.env.VERCEL_GIT_COMMIT_SHA
  || execSync('git rev-parse HEAD', { cwd: path.resolve(__dirname, '..') }).toString().trim();
const version = rawSha.substring(0, 8);

const root    = path.resolve(__dirname, '..');
const targets = [
  path.join(root, 'app/index.html'),
  path.join(root, 'index.html'),
];

let changed = 0;
targets.forEach(file => {
  if (!fs.existsSync(file)) return;
  const src     = fs.readFileSync(file, 'utf8');
  const updated = src.replace(/(\.(css|js))\?v=[^"'&\s]*/g, `$1?v=${version}`);
  if (updated !== src) {
    fs.writeFileSync(file, updated);
    console.log(`  ✓  ${path.relative(root, file)}  →  ?v=${version}`);
    changed++;
  } else {
    console.log(`  –  ${path.relative(root, file)}  (no v= found, skipped)`);
  }
});
console.log(`\ninject-version: done. ${changed} file(s) updated. version=${version}`);
