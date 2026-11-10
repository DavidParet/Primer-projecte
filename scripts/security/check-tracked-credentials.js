'use strict';
// Git tracked files only; intentionally no secret values in stdout/stderr.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const SECRET_PATTERNS = [
  { name: 'Vercel-like personal access token',
    regex: /\bvca_[A-Za-z0-9_-]{24,}\b/g }
];

function scanText(text) {
  return SECRET_PATTERNS
    .filter(({regex})=>{regex.lastIndex=0;return regex.test(text);})
    .map(({name})=>name);
}

function scanRepository() {
  const tracked=execFileSync('git',['ls-files','-z'],{
    encoding:'buffer',maxBuffer:20*1024*1024
  }).toString('utf8').split('\0').filter(Boolean);
  const problems=[];
  for(const path of tracked) {
    let raw;
    try { raw=readFileSync(path); }
    catch(error) {
      if(error.code==='ENOENT')continue; // git index may include staged deletion
      throw error;
    }
    if(raw.length>5*1024*1024 || raw.includes(0)) continue;
    const matches=scanText(raw.toString('utf8'));
    if(matches.length)problems.push({path,kinds:matches});
  }
  return problems;
}

if(require.main===module) {
  const problems=scanRepository();
  for(const problem of problems) {
    // Filename + category only; NEVER print the matched credential.
    process.stderr.write('Potential tracked credential in '+problem.path+
      ' ('+problem.kinds.join(', ')+')\n');
  }
  if(problems.length) {
    process.stderr.write('Security gate failed: remove and rotate exposed secrets.\n');
    process.exitCode=1;
  } else {
    process.stdout.write('Tracked-file token scan passed (targeted Vercel pattern).\n');
  }
}

module.exports = { scanText, scanRepository };
