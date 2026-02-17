# Security Audit Workflow

This workflow is focused on **prompt injection vulnerabilities** and **bug/security detection** for `converge-platform`.

## What it runs

1. Dependency scan (`npm audit`)
2. CodeQL semantic analysis
3. Semgrep (custom prompt-injection + general security rules)
4. Prompt-security adversarial corpus tests (`run-prompt-security-tests.js`)
5. Secret scanning (TruffleHog + Gitleaks)
6. Input validation audit script
7. Lint/syntax checks
8. Behavior analysis with safe local endpoints
9. Security summary job

## Prompt Injection Coverage

Custom rules catch:
- direct user input interpolated into prompts
- indirect injection via external content
- unsafe tool/function calling from model output
- eval/exec-style sinks
- delimiter/context-break patterns
- autonomous loops without obvious safeguards

## Safety posture

- Minimal GitHub permissions
- `persist-credentials: false`
- `npm ci --ignore-scripts`
- No deploy/write operations
- Findings reported via logs/SARIF

## Local run

```bash
semgrep --config .semgrep/prompt-injection.yml scripts/
semgrep --config .semgrep/general-security.yml scripts/
node .github/scripts/detect-prompt-injection.js
node .github/scripts/validate-inputs.js
```
