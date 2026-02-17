import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export function secretsDir() {
  return join(homedir(), '.openclaw', 'secrets', 'starknet');
}

export function listAccounts() {
  const dir = secretsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => {
    const p = join(dir, f);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { address: j.address, path: p };
  });
}

export function getAccountAddress(accountIndex = 0) {
  const accts = listAccounts();
  if (accts.length === 0) throw new Error('No Starknet accounts found under ~/.openclaw/secrets/starknet');
  const hit = accts[accountIndex];
  if (!hit) throw new Error(`Account index ${accountIndex} not found (have ${accts.length})`);
  return hit.address;
}
