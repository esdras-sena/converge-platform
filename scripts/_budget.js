import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DIR = join(homedir(), '.openclaw', 'converge');
const LEDGER = join(DIR, 'fee-ledger.json');
const LEDGER_LOCK = `${LEDGER}.lock`;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 15000;

const SLEEP_BUF = new SharedArrayBuffer(4);
const SLEEP_ARR = new Int32Array(SLEEP_BUF);

function sleepMs(ms) {
  Atomics.wait(SLEEP_ARR, 0, 0, ms);
}

function acquireLedgerLock() {
  mkdirSync(DIR, { recursive: true });
  const start = Date.now();

  while (true) {
    try {
      return openSync(LEDGER_LOCK, 'wx');
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;

      try {
        const st = statSync(LEDGER_LOCK);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { unlinkSync(LEDGER_LOCK); } catch {}
          continue;
        }
      } catch {
        // Lock file was removed between checks; retry immediately.
        continue;
      }

      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`Timeout acquiring ledger lock: ${LEDGER_LOCK}`);
      }
      sleepMs(LOCK_RETRY_MS);
    }
  }
}

function releaseLedgerLock(lockFd) {
  try { closeSync(lockFd); } catch {}
  try { unlinkSync(LEDGER_LOCK); } catch {}
}

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
  const max = BigInt(maxPerDayRaw);
  const additional = BigInt(additionalRaw);
  if (max < 0n) throw new RangeError('maxPerDayRaw must be non-negative');
  if (additional < 0n) throw new RangeError('additionalRaw must be non-negative');

  const spent = getSpentTodayRaw();
  return spent + additional <= max;
}

export function recordSpendRaw(additionalRaw, meta = {}) {
  const additional = BigInt(additionalRaw);
  if (additional < 0n) throw new RangeError('additionalRaw must be non-negative');

  const lockFd = acquireLedgerLock();
  try {
    const l = loadLedger();
    const k = todayKey();
    if (!l.days) l.days = {};
    if (!l.days[k]) l.days[k] = { spentRaw: '0', items: [] };
    const prev = BigInt(l.days[k].spentRaw || '0');
    const next = prev + additional;
    l.days[k].spentRaw = next.toString();
    l.days[k].items = l.days[k].items || [];
    l.days[k].items.push({ ts: Date.now(), feeRaw: additional.toString(), ...meta });
    saveLedger(l);
    return next;
  } finally {
    releaseLedgerLock(lockFd);
  }
}

export const DEFAULT_MAX_FEE_PER_DAY_RAW = (2n * 10n ** 18n).toString(); // 2 STRK
