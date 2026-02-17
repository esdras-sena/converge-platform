import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DIR = join(homedir(), '.openclaw', 'converge');
const LEDGER = join(DIR, 'fee-ledger.json');

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function loadLedger() {
  if (!existsSync(LEDGER)) return { days: {} };
  try { return JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { return { days: {} }; }
}

export function saveLedger(l) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n', 'utf8');
}

export function getSpentTodayRaw() {
  const l = loadLedger();
  const k = todayKey();
  return BigInt(l.days?.[k]?.spentRaw || '0');
}

export function canSpendMore(maxPerDayRaw, additionalRaw) {
  const spent = getSpentTodayRaw();
  return spent + BigInt(additionalRaw) <= BigInt(maxPerDayRaw);
}

export function recordSpendRaw(additionalRaw, meta = {}) {
  const l = loadLedger();
  const k = todayKey();
  if (!l.days) l.days = {};
  if (!l.days[k]) l.days[k] = { spentRaw: '0', items: [] };
  const prev = BigInt(l.days[k].spentRaw || '0');
  const next = prev + BigInt(additionalRaw);
  l.days[k].spentRaw = next.toString();
  l.days[k].items = l.days[k].items || [];
  l.days[k].items.push({ ts: Date.now(), feeRaw: String(additionalRaw), ...meta });
  saveLedger(l);
  return next;
}

export const DEFAULT_MAX_FEE_PER_DAY_RAW = (2n * 10n ** 18n).toString(); // 2 STRK
