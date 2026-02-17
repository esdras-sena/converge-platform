import fs from 'fs';
import os from 'os';
import path from 'path';

export const DEFAULT_RPC_MAINNET = 'https://rpc.starknet.lava.build:443';
export const DEFAULT_RPC_SEPOLIA = 'https://rpc.starknet-testnet.lava.build:443';

export function jsonStringifySafe(obj) {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export function fail(message, stack) {
  console.error(jsonStringifySafe({ error: message, stack }));
  process.exit(1);
}

export function secretsDir() {
  return path.join(os.homedir(), '.openclaw', 'secrets', 'starknet');
}

function normalizeAddressForMatch(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  return s.startsWith('0x') ? s : `0x${s}`;
}

export function resolveArtifactForAddress(accountAddress) {
  if (typeof accountAddress !== 'string' || !accountAddress.trim()) {
    throw new Error('Invalid accountAddress: expected non-empty string');
  }

  const normalizedAddress = normalizeAddressForMatch(accountAddress);
  const dir = secretsDir();
  if (!fs.existsSync(dir)) throw new Error(`Secrets dir not found: ${dir}`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const matches = files.filter((f) => {
    const baseName = f.slice(0, -5); // strip .json
    return normalizeAddressForMatch(baseName) === normalizedAddress;
  });

  if (matches.length === 0) {
    throw new Error(`No artifact for address: ${accountAddress}`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple artifacts for address ${accountAddress}: ${matches.join(', ')}`);
  }

  const artifactPath = path.join(dir, matches[0]);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return { artifactPath, artifact };
}

export function readPrivateKey(privateKeyPath) {
  if (!privateKeyPath) throw new Error('Missing privateKeyPath');
  if (!fs.existsSync(privateKeyPath)) throw new Error(`Key not found: ${privateKeyPath}`);
  return fs.readFileSync(privateKeyPath, 'utf-8').trim();
}
