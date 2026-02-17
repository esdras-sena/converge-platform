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

export function resolveArtifactForAddress(accountAddress) {
  const dir = secretsDir();
  if (!fs.existsSync(dir)) throw new Error('Secrets dir not found');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const hit = files.find((f) => f.toLowerCase().includes(accountAddress.toLowerCase()));
  if (!hit) throw new Error(`No artifact for address: ${accountAddress}`);
  const artifactPath = path.join(dir, hit);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return { artifactPath, artifact };
}

export function readPrivateKey(privateKeyPath) {
  if (!privateKeyPath) throw new Error('Missing privateKeyPath');
  if (!fs.existsSync(privateKeyPath)) throw new Error(`Key not found: ${privateKeyPath}`);
  return fs.readFileSync(privateKeyPath, 'utf-8').trim();
}
