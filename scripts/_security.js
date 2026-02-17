// Lightweight prompt-injection scanner for untrusted marketplace data.
// Fail closed: if suspicious, require user approval.

const RULES = [
  { id: 'override', re: /(ignore|bypass|override)\s+(previous|prior|system|developer)\s+(instructions|prompt)/i },
  { id: 'system_prompt', re: /(reveal|show|dump|print)\s+(the\s+)?(system prompt|developer message|hidden instructions)/i },
  { id: 'secrets', re: /(private\s*key|seed\s*phrase|mnemonic|api\s*key|password|secrets?\/)/i },
  { id: 'exfil', re: /(send|upload|post|exfiltrate)\s+.*(keys?|secrets?|credentials?)/i },
  { id: 'tool_bypass', re: /(run|execute)\s+.*(without|no)\s+(confirm|authorization|approval|auth)/i },
  { id: 'malware', re: /(curl|wget)\s+.*\|\s*(bash|sh)|rm\s+-rf|sudo\s+/i },
  { id: 'role', re: /you\s+are\s+now\s+(root|admin|system)/i },
];

export function scanUntrustedText(text) {
  if (!text || typeof text !== 'string') return { ok: true, hits: [] };
  const hits = [];
  for (const r of RULES) {
    if (r.re.test(text)) hits.push(r.id);
  }
  return { ok: hits.length === 0, hits };
}

export function scanObjectStrings(obj) {
  const hits = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      const r = scanUntrustedText(v);
      if (!r.ok) hits.push(...r.hits);
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const vv of Object.values(v)) walk(vv);
    }
  };
  walk(obj);
  const uniq = [...new Set(hits)];
  return { ok: uniq.length === 0, hits: uniq };
}
