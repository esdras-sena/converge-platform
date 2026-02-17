#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = 'scripts';

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
let weak = 0;
for (const f of files) {
  const c = readFileSync(f, 'utf8');
  const hasArgvParse = /JSON\.parse\(process\.argv\[2\]\)/.test(c);
  const hasGuards = /(fail\(|throw new Error|typeof\s+\w+|Number\.isFinite|BigInt\(|parseU256\(|parseU64\()/m.test(c);
  if (hasArgvParse && !hasGuards) {
    weak++;
    console.log(`[weak-validation] ${f}`);
  }
}
console.log(`[validation-audit] files=${files.length} weak=${weak}`);
process.exit(0);
