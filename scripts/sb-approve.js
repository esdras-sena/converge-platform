#!/usr/bin/env node
/**
 * sb-approve.js
 *
 * Execute a pending tx plan (created by worker when fullAutonomy=false).
 *
 * Usage:
 *   node scripts/sb-approve.js '{"id":"<pendingId>","dryRun":false}'
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const DIR = join(homedir(), '.openclaw', 'converge');
const PENDING = join(DIR, 'pending.json');

function out(x) { console.log(JSON.stringify(x, null, 2)); }
function fail(msg) { console.error(JSON.stringify({ error: msg })); process.exit(1); }

function loadPending() {
  if (!existsSync(PENDING)) return { items: [] };
  try { return JSON.parse(readFileSync(PENDING, 'utf8')); } catch { return { items: [] }; }
}

function savePending(p) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(PENDING, JSON.stringify(p, null, 2) + '\n', 'utf8');
}

function runNode(scriptPath, jsonArg) {
  const r = spawnSync('node', [scriptPath, JSON.stringify(jsonArg)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `node failed: ${scriptPath}`);
  return JSON.parse(r.stdout);
}

async function main() {
  const raw = process.argv[2];
  if (!raw) fail('Missing input JSON with id');
  let input;
  try { input = JSON.parse(raw); } catch (e) { fail(`JSON parse: ${e.message}`); }

  const id = input.id;
  if (!id) fail('Missing id');

  const pending = loadPending();
  const item = (pending.items || []).find((x) => x.id === id);
  if (!item) fail(`Pending id not found: ${id}`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const typhoonResolve = join(__dirname, '..', '..', 'typhoon-starknet-account', 'scripts', 'resolve-smart.js');

  const plan = { ...item.plan, dryRun: Boolean(input.dryRun), skipAuth: false };
  const execResult = runNode(typhoonResolve, plan);

  item.executedAt = Date.now();
  item.exec = { nextStep: execResult.nextStep, status: execResult.execution?.status };
  savePending(pending);

  out({ success: true, id, execResult });
}

main().catch((e) => fail(e.message));
