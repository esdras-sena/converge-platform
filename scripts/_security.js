// Lightweight prompt-injection scanner for untrusted marketplace data.
// Fail closed: if suspicious, require user approval.

const RULES = [
  { id: 'override', re: /(ignore|bypass|override|disregard)\s+(previous|prior|system|developer)\s+(instructions|prompt|rules?)/i },
  { id: 'system_prompt', re: /(reveal|show|dump|print|leak)\s+(the\s+)?(system prompt|developer message|hidden instructions|policy)/i },
  { id: 'secrets', re: /(private\s*key|seed\s*phrase|mnemonic|api\s*key|password|secret\s*key|credentials?)/i },
  { id: 'exfil', re: /(send|upload|post|exfiltrate|transfer)\s+.*(keys?|secrets?|credentials?|wallet|token)/i },
  { id: 'tool_bypass', re: /(run|execute|call)\s+.*(without|no|skip)\s+(confirm|authorization|approval|auth|permission)/i },
  { id: 'malware', re: /(curl|wget)\s+.*\|\s*(bash|sh)|rm\s+-rf|sudo\s+|chmod\s+777/i },
  { id: 'role', re: /you\s+are\s+now\s+(root|admin|system|developer)/i },
  { id: 'jailbreak', re: /(do\s+anything\s+now|dan\s+mode|jailbreak|simulate\s+developer\s+mode)/i },
  { id: 'prompt_delimiter', re: /(<\/?system>|<\/?developer>|<\/?assistant>|```\s*(system|developer))/i },
  { id: 'encoding_obfuscation', re: /(base64|hex|rot13|unicode\s+escape)\s+(decode|decode this|payload)/i },
];

function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim();
}

export function scanUntrustedText(text) {
  if (!text || typeof text !== 'string') return { ok: true, hits: [] };
  const normalized = normalizeText(text);
  const hits = [];
  for (const r of RULES) {
    if (r.re.test(normalized)) hits.push(r.id);
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
