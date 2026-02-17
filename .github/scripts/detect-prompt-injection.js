#!/usr/bin/env node
/**
 * Custom Prompt Injection Detector for Converge Platform
 * 
 * Scans for AI-agent specific vulnerability patterns:
 * - Direct prompt construction from user input
 * - Missing input validation before LLM calls
 * - Insecure JSON parsing of agent configs
 * - Autonomy loops without safeguards
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_DIR = join(__dirname, '..', '..', 'scripts');

// Risk patterns for prompt injection detection
const PATTERNS = {
  // Direct user input interpolation into prompts/messages
  directPromptInjection: {
    severity: 'HIGH',
    regex: /(?:prompt|message|content|text)\s*[=:]\s*[`"'][^`"']*\$\{(?:input|args|argv|cfg|config|rest)\.[a-zA-Z_]+/gi,
    description: 'Direct user input interpolation into LLM prompt',
  },
  
  // JSON.parse on user input without validation
  unvalidatedJsonParse: {
    severity: 'HIGH',
    regex: /JSON\.parse\s*\(\s*(?:process\.argv|input|args|raw|cfg|config)\s*\)/gi,
    description: 'Unvalidated JSON.parse on potentially untrusted input',
  },
  
  // Dynamic require with user-controlled path
  dynamicRequire: {
    severity: 'CRITICAL',
    regex: /require\s*\(\s*(?:input|args|cfg|config|process\.env)\s*\)/gi,
    description: 'Dynamic require with user-controlled input',
  },
  
  // Autonomy loops without visible safeguards
  autonomousLoop: {
    severity: 'MEDIUM',
    regex: /while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\)/gi,
    description: 'Autonomous loop detected - verify safety guards exist',
    requireContext: true, // Needs manual review for context
  },
  
  // spawnSync/exec with user input
  commandInjection: {
    severity: 'CRITICAL',
    regex: /(?:spawnSync|execSync|exec)\s*\([^)]*(?:\+|\$\{)/gi,
    description: 'Potential command injection via user input',
  },
  
  // Missing validation before config usage
  missingValidation: {
    severity: 'MEDIUM',
    regex: /const\s+\{[^}]*\}\s*=\s*(?:cfg|config|input|args)\s*;(?:[^}]|
)*?(?!if\s*\([^)]*(?:validate|check|assert))\w+\s*[=:]/gi,
    description: 'Destructured config values used without visible validation',
  },
  
  // System prompt exposure
  systemPromptLeakage: {
    severity: 'LOW',
    regex: /console\.(?:log|error)\s*\([^)]*(?:systemPrompt|SYSTEM_PROMPT|sysPrompt)/gi,
    description: 'System prompt may be logged',
  },
  
  // Unsafe bid price calculation
  unsafeBidCalculation: {
    severity: 'HIGH',
    regex: /BigInt\s*\(\s*10000\s*-\s*(?:bidDiscountBps|bps|discount)\s*\)/gi,
    description: 'Bid calculation - verify bps validation exists',
  },
};

// Whitelist of safe patterns (false positive reduction)
const SAFE_PATTERNS = [
  /JSON\.parse\s*\(\s*readFileSync\s*\(/, // Reading local config files
  /JSON\.parse\s*\(\s*process\.argv\[2\]\s*\)/, // Standard CLI pattern (still risky but common)
];

function findJavaScriptFiles(dir) {
  const files = [];
  
  function recurse(currentDir) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory() && !entry.includes('node_modules')) {
        recurse(fullPath);
      } else if (stat.isFile() && extname(entry) === '.js') {
        files.push(fullPath);
      }
    }
  }
  
  recurse(dir);
  return files;
}

function analyzeFile(filepath) {
  const content = readFileSync(filepath, 'utf8');
  const lines = content.split('\n');
  const findings = [];
  
  // Check for whitelisted safe patterns
  const isWhitelisted = SAFE_PATTERNS.some(pattern => pattern.test(content));
  
  for (const [patternName, patternDef] of Object.entries(PATTERNS)) {
    const matches = content.matchAll(patternDef.regex);
    
    for (const match of matches) {
      // Skip if whitelisted and not CRITICAL
      if (isWhitelisted && patternDef.severity !== 'CRITICAL') {
        continue;
      }
      
      // Calculate line number
      const pos = match.index;
      const lineNum = content.substring(0, pos).split('\n').length;
      const line = lines[lineNum - 1]?.trim() || '';
      
      findings.push({
        file: filepath,
        line: lineNum,
        column: pos - content.lastIndexOf('\n', pos),
        severity: patternDef.severity,
        pattern: patternName,
        description: patternDef.description,
        code: line.substring(0, 80),
        requireContext: patternDef.requireContext || false,
      });
    }
  }
  
  return findings;
}

function checkValidationFunctions(content) {
  // Check if file has validation helper functions
  const hasValidateInput = /function\s+validate(?:Input|Config|Args)/.test(content);
  const hasTypeChecking = /typeof\s+\w+\s*===?\s*['"]\w+['"]/.test(content);
  const hasRangeChecks = /(?:if\s*\([^)]*(?:\|\||\u003c=?|\u003e=?)[^)]*\))/.test(content);
  
  return { hasValidateInput, hasTypeChecking, hasRangeChecks };
}

function main() {
  console.log('🔍 Converge Platform Security Scanner');
  console.log('   Focus: Prompt Injection & AI Agent Vulnerabilities\n');
  
  const files = findJavaScriptFiles(TARGET_DIR);
  console.log(`Scanning ${files.length} JavaScript files...\n`);
  
  let allFindings = [];
  let filesWithValidation = 0;
  let filesWithoutValidation = 0;
  
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const findings = analyzeFile(file);
    const validationStatus = checkValidationFunctions(content);
    
    if (validationStatus.hasValidateInput || validationStatus.hasTypeChecking) {
      filesWithValidation++;
    } else {
      filesWithoutValidation++;
    }
    
    allFindings = allFindings.concat(findings);
  }
  
  // Summary
  console.log('📊 Scan Summary');
  console.log('─'.repeat(60));
  console.log(`Files scanned:           ${files.length}`);
  console.log(`Files with validation:   ${filesWithValidation}`);
  console.log(`Files lacking validation: ${filesWithoutValidation}`);
  console.log(`Total findings:          ${allFindings.length}\n`);
  
  // Group by severity
  const critical = allFindings.filter(f => f.severity === 'CRITICAL');
  const high = allFindings.filter(f => f.severity === 'HIGH');
  const medium = allFindings.filter(f => f.severity === 'MEDIUM');
  const low = allFindings.filter(f => f.severity === 'LOW');
  
  if (critical.length > 0) {
    console.log(`🚨 CRITICAL (${critical.length})`);
    critical.forEach(f => {
      console.log(`   ${f.file}:${f.line} - ${f.description}`);
      console.log(`   Code: ${f.code}`);
    });
    console.log();
  }
  
  if (high.length > 0) {
    console.log(`⚠️  HIGH (${high.length})`);
    high.forEach(f => {
      console.log(`   ${f.file}:${f.line} - ${f.description}`);
      console.log(`   Code: ${f.code}`);
    });
    console.log();
  }
  
  if (medium.length > 0) {
    console.log(`⚡ MEDIUM (${medium.length})`);
    medium.forEach(f => {
      console.log(`   ${f.file}:${f.line} - ${f.description}`);
      if (f.requireContext) console.log(`   ⚠️  Requires manual context review`);
    });
    console.log();
  }
  
  if (low.length > 0) {
    console.log(`ℹ️  LOW (${low.length})`);
    low.slice(0, 5).forEach(f => {
      console.log(`   ${f.file}:${f.line} - ${f.description}`);
    });
    if (low.length > 5) console.log(`   ... and ${low.length - 5} more`);
    console.log();
  }
  
  // Exit with error code if critical/high findings
  if (critical.length > 0 || high.length > 0) {
    console.log('❌ Security scan FAILED - Critical/High severity issues found');
    process.exit(1);
  }
  
  console.log('✅ Security scan PASSED - No critical or high severity issues');
  process.exit(0);
}

main();
