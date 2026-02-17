import { uint256 } from 'starknet';

export function parseHexOrDecFelt(x, name = 'value') {
  if (typeof x !== 'string') throw new Error(`${name} must be a string`);
  const v = x.trim();
  if (!v) throw new Error(`${name} is empty`);
  // accept 0x.. or decimal string
  if (v.startsWith('0x') || /^[0-9]+$/.test(v)) return v;
  throw new Error(`${name} must be 0x-hex or decimal string`);
}

export function parseU64(x, name = 'u64') {
  if (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0) return x;
  if (typeof x === 'string' && /^[0-9]+$/.test(x)) return Number(x);
  throw new Error(`${name} must be a non-negative integer (number or numeric string)`);
}

export function parseU256(x, name = 'u256') {
  // Accept:
  // - decimal string (assumed already in smallest units)
  // - hex string (0x...)
  // - { low, high } object
  if (typeof x === 'object' && x && 'low' in x && 'high' in x) {
    return x;
  }
  if (typeof x === 'string') {
    const v = x.trim();
    if (!v) throw new Error(`${name} is empty`);
    if (v.startsWith('0x')) {
      return uint256.bnToUint256(BigInt(v));
    }
    if (/^[0-9]+$/.test(v)) {
      return uint256.bnToUint256(BigInt(v));
    }
  }
  throw new Error(`${name} must be {low,high} or a decimal/0x string`);
}

export function helpCommon() {
  return {
    note:
      'These wrappers are ABI-from-chain only. They will fail until the ConvergeEscrow contract is deployed and verified with an onchain ABI.',
    requiredInput: {
      accountAddress: '0x... (must exist under ~/.openclaw/secrets/starknet/*.json)',
      escrowAddress: '0x... (deployed ConvergeEscrow address)',
    },
  };
}
