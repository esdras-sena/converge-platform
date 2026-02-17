import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_MAX_FEE_PER_DAY_RAW } from './_budget.js';

const DIR = join(homedir(), '.openclaw', 'converge');
export const CONFIG_PATH = join(DIR, 'agent-config.json');

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return {
      escrowAddress: process.env.ESCROW_ADDRESS || '',
      fullAutonomy: false,
      maxFeePerDayRaw: DEFAULT_MAX_FEE_PER_DAY_RAW,
      minMarginPct: 15,
      bidDiscountBps: 500,
      limit: 20,
      token: '',
      accountIndex: 0,
    };
  }
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return {
      escrowAddress: cfg.escrowAddress || process.env.ESCROW_ADDRESS || '',
      fullAutonomy: Boolean(cfg.fullAutonomy),
      maxFeePerDayRaw: cfg.maxFeePerDayRaw || DEFAULT_MAX_FEE_PER_DAY_RAW,
      minMarginPct: cfg.minMarginPct ?? 15,
      bidDiscountBps: cfg.bidDiscountBps ?? 500,
      limit: cfg.limit ?? 20,
      token: cfg.token || '',
      accountIndex: Number.isFinite(Number(cfg.accountIndex)) ? Number(cfg.accountIndex) : 0,
    };
  } catch {
    return {
      escrowAddress: process.env.ESCROW_ADDRESS || '',
      fullAutonomy: false,
      maxFeePerDayRaw: DEFAULT_MAX_FEE_PER_DAY_RAW,
      minMarginPct: 15,
      bidDiscountBps: 500,
      limit: 20,
      token: '',
      accountIndex: 0,
    };
  }
}
