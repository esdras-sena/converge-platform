#!/usr/bin/env node
/**
 * Input Validation Audit Script
 * 
 * Checks that all exported functions in the codebase properly validate
 * their inputs before processing.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_DIR = join(__dirname, '..', '..', 'scripts');

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

function analyzeValidation(filepath) {
  const content = readFileSync(filepath, 'utf8');
  const issues = [];
  
  // Find exported functions
  const exportFunctionRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(\s*([^)]*)\s*\)/g;
  let match;
  
  while ((match = exportFunctionRegex.exec(content)) !== null) {
    const funcName = match[1];
    const params = match[2].split(',').map(p => p.trim()).filter(Boolean);
    
    // Find function body
    const funcStart = match.index;
    let braceCount = 0;
    let funcEnd = funcStart;
    let foundFirstBrace = false;
    
    for (let i = funcStart; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        foundFirstBrace = true;
      } else if (content[i] === '}') {
        braceCount--;
      }
      
      if (foundFirstBrace && braceCount === 0) {
        funcEnd = i;
        break;
      }
    }
    
    const funcBody = content.substring(funcStart, funcEnd);
    
    // Check for validation patterns
    const hasValidation = 
      /(?:if\s*\([^)]*(?:!\w+|null|undefined|typeof)[^)]*\)\s*(?:throw|return|fail))/.test(funcBody) ||
      /BigInt\s*\([^)]*\)/.test(funcBody) ||
      /Number\s*\([^)]*\)/.test(funcBody) ||
      /String\s*\([^)]*\)/.test(funcBody) ||
      /parseU256|parseU64|parseHexOrDecFelt/.test(funcBody);
    
    const hasSanitization = 
      /trim\s*\(\s*\)/.test(funcBody) ||
      /replace\s*\([^)]*\)/.test(funcBody);
    
    if (!hasValidation && params.length > 0) {
      // Check if function actually uses parameters
      const usesParams = params.some(p => {
        const paramName = p.replace(/[:=].*$/, '').trim();
        const usageRegex = new RegExp(`\\b${paramName}\\b`, 'g');
        return usageRegex.test(funcBody);
      });
      
      if (usesParams) {
        issues.push({
          file: filepath,
          function: funcName,
          params: params,
          line: content.substring(0, funcStart).split('\n').length,
          hasValidation: false,
          hasSanitization: hasSanitization,
          recommendation: 'Add type validation, range checks, or use existing parse helpers'
        });
      }
    }
  }
  
  return issues;
}

function main() {
  console.log('🛡️  Input Validation Audit\n');
  
  const files = findJavaScriptFiles(TARGET_DIR);
  let allIssues = [];
  
  for (const file of files) {
    const issues = analyzeValidation(file);
    allIssues = allIssues.concat(issues);
  }
  
  console.log(`Scanned ${files.length} files`);
  console.log(`Found ${allIssues.length} functions lacking input validation\n`);
  
  if (allIssues.length > 0) {
    console.log('Functions needing validation:');
    console.log('─'.repeat(80));
    
    allIssues.forEach(issue => {
      console.log(`\n📄 ${issue.file}:${issue.line}`);
      console.log(`   Function: ${issue.function}(${issue.params.join(', ')})`);
      console.log(`   Validation: ❌ Missing`);
      console.log(`   Sanitization: ${issue.hasSanitization ? '✅ Present' : '❌ Missing'}`);
      console.log(`   💡 ${issue.recommendation}`);
    });
    
    console.log('\n⚠️  Consider adding validation using:');
    console.log('   - parseU256() / parseU64() for numeric values');
    console.log('   - parseHexOrDecFelt() for addresses');
    console.log('   - BigInt() with try/catch for large integers');
    console.log('   - Range checks (value < 0 || value > MAX)');
    console.log('   - Type guards (typeof x === "string")');
  } else {
    console.log('✅ All exported functions appear to have input validation');
  }
  
  // Exit 0 - this is advisory, not blocking
  process.exit(0);
}

main();
