# Security Audit Workflow Documentation

## Overview

This CI/CD workflow provides comprehensive security scanning for the Converge Platform, with a focus on **Prompt Injection vulnerabilities** and general bug detection in AI agent code.

## Architecture

### Multi-Layer Security Scanning

```
┌─────────────────────────────────────────────────────────────────┐
│                      SECURITY WORKFLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. DEPENDENCY SCAN                                             │
│     ├── npm audit (high/critical CVEs)                         │
│     └── outdated dependency detection                          │
│                                                                 │
│  2. STATIC ANALYSIS (CodeQL)                                    │
│     ├── Semantic analysis of JavaScript                        │
│     └── Security-extended query suite                          │
│                                                                 │
│  3. PROMPT INJECTION SCAN                                       │
│     ├── Custom Semgrep rules (10 patterns)                     │
│     ├── OWASP Top 10 patterns                                  │
│     └── Custom JavaScript detector                             │
│                                                                 │
│  4. SECRET DETECTION                                            │
│     ├── TruffleHog (history scan)                              │
│     └── Gitleaks (pattern matching)                            │
│                                                                 │
│  5. INPUT VALIDATION AUDIT                                      │
│     ├── Missing validation detection                           │
│     └── Type coercion checks                                   │
│                                                                 │
│  6. LINT & TYPE CHECK                                           │
│     ├── ESLint with security rules                             │
│     └── Prettier formatting                                    │
│                                                                 │
│  7. BEHAVIOR ANALYSIS                                           │
│     ├── Safe execution tests                                   │
│     └── Prototype pollution checks                             │
│                                                                 │
│  8. LOCKFILE INTEGRITY                                          │
│     └── Supply chain verification                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Custom Detection Rules

### Prompt Injection Patterns (`.semgrep/prompt-injection.yml`)

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `prompt-injection-unvalidated-input` | ERROR | Direct user input into LLM prompts |
| `prompt-injection-dynamic-system-prompt` | WARNING | Dynamic system prompt construction |
| `prompt-injection-external-data` | ERROR | External data in prompts (files, APIs) |
| `prompt-injection-missing-validation` | WARNING | User input without validation |
| `prompt-injection-code-execution` | ERROR | LLM output passed to eval/new Function |
| `prompt-injection-delimiter-bypass` | WARNING | Prompt delimiter characters |
| `prompt-injection-json-parse` | WARNING | JSON.parse on LLM responses |
| `prompt-injection-tool-calling` | ERROR | Unvalidated tool/function calls |
| `prompt-injection-system-leakage` | INFO | System prompt exposure risk |
| `prompt-injection-autonomy-risk` | WARNING | Agent loops without safeguards |

### General Security (`.semgrep/general-security.yml`)

- Path traversal detection
- Command injection
- Hardcoded secrets
- Weak randomness
- Prototype pollution
- Unsafe deserialization

## Safety Measures

### Workflow Security

1. **Minimal Permissions**
   ```yaml
   permissions:
     contents: read
     security-events: write
     actions: read
   ```

2. **No Secret Exposure**
   - All scans are read-only
   - No environment secrets in logs
   - Artifacts exclude sensitive data

3. **Supply Chain Protection**
   - `persist-credentials: false` on checkout
   - `--ignore-scripts` for npm install
   - Lockfile integrity verification

4. **Timeout Protection**
   - All jobs have timeout limits
   - Concurrency cancellation
   - No infinite loops

### Running Locally

```bash
# Install Semgrep
pip install semgrep

# Run custom rules
semgrep --config .semgrep/prompt-injection.yml scripts/
semgrep --config .semgrep/general-security.yml scripts/

# Run custom detector
node .github/scripts/detect-prompt-injection.js

# Run validation audit
node .github/scripts/validate-inputs.js
```

## Interpreting Results

### Severity Levels

- **CRITICAL**: Immediate action required - code execution risk
- **HIGH**: Security vulnerability - prompt injection, command injection
- **MEDIUM**: Potential issue - requires manual review
- **LOW**: Advisory - best practice recommendation
- **INFO**: FYI - awareness only

### False Positive Handling

Add comments to suppress valid exceptions:

```javascript
// nosemgrep: prompt-injection-unvalidated-input
// Reason: Input is validated by parseU256() before this point
const bidPrice = userInput;
```

## Integration

### GitHub Actions

The workflow runs on:
- Push to `main` or `dev`
- Pull requests to `main` or `dev`
- Daily scheduled scan (06:00 UTC)

### Required Secrets

None for basic operation. Optional:
- `GITLEAKS_LICENSE`: For enhanced secret scanning

### SARIF Upload

Results are uploaded to GitHub Security tab for:
- CodeQL findings
- Semgrep findings

## Troubleshooting

### Semgrep Timeout

If Semgrep times out on large files:
```bash
semgrep --timeout 60 --config .semgrep/ ...
```

### CodeQL Database Issues

```bash
# Clean and rebuild
codeql database cleanup --mode=brutal
codeql database create ...
```

### Custom Script Failures

Ensure Node.js 20+:
```bash
node --version  # Should be v20+
```

## References

- [OWASP LLM Top 10](https://genai.owasp.org/)
- [Prompt Injection Guide](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Semgrep Rules](https://semgrep.dev/docs/)
- [CodeQL JavaScript](https://codeql.github.com/docs/codeql-language-guides/javascript/)
