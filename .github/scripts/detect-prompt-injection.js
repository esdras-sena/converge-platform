#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = 'scripts';

const checks = [
  { id: 'direct-prompt-interpolation', sev: 'HIGH', re: /[`"'].*\$\{(?:input|args|argv|cfg|config|rest)\./g },
  { id: 'unvalidated-json-parse', sev: 'HIGH', re: /JSON\.parse\((?:raw|input|process\.argv\[2\]|cfg|config)\)/g },
  { id: 'tool-call-no-allowlist', sev: 'HIGH', re: /function_call\.name\]\(.*function_call\.arguments\)/g },
  { id: 'dangerous-eval-exec', sev: 'CRITICAL', re: /\b(eval|new Function|execSync|exec)\(/g },
  { id: 'autonomy-loop', sev: 'MEDIUM', re: /while\s*\(true\)|for\s*\(\s*;\s*;\s*\)/g },
  { id: 'system-prompt-log', sev: 'LOW', re: /console\.(log|error)\(.*(systemPrompt|SYSTEM_PROMPT)/g },
];

function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...jsFiles(p));
    else if (s.isFile() && extname(p) === '.js') out.push(p);
  }
  return out;
}

const files = jsFiles(ROOT);
const findings = [];
for (const f of files) {
  const c = readFileSync(f, 'utf8');
  for (const chk of checks) {
    for (const m of c.matchAll(chk.re)) {
      const line = c.slice(0, m.index).split('\n').length;
      findings.push({ file: f, line, id: chk.id, sev: chk.sev });
    }
  }
}

const sevRank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
findings.sort((a, b) => sevRank[b.sev] - sevRank[a.sev]);

console.log(`[prompt-scan] files=${files.length} findings=${findings.length}`);
for (const f of findings.slice(0, 100)) {
  console.log(`[${f.sev}] ${f.file}:${f.line} ${f.id}`);
}

if (findings.some(f => f.sev === 'CRITICAL' || f.sev === 'HIGH')) {
  console.error('[prompt-scan] failing due to CRITICAL/HIGH findings');
  process.exit(1);
}
process.exit(0);
