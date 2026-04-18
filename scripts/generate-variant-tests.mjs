/**
 * Generates variant tests from vai-engine.test.ts
 * Strategy: copy the entire file, rename all tests with " (variant)" suffix,
 * and apply light user-content modifications that preserve test assertions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(__dirname, '../packages/core/__tests__/vai-engine.test.ts');
const outPath = resolve(__dirname, '../packages/core/__tests__/vai-engine-variants.test.ts');

let src = readFileSync(srcPath, 'utf-8');

// Step 1: Add " (variant)" to ALL it() test names
let testCount = 0;

// Handle: it('name', ...) and it("name", ...)
let result = src.replace(
  /(\bit\s*\(\s*)(['"])((?:(?!\2).)*?)\2/g,
  (match, prefix, quote, name) => {
    testCount++;
    return `${prefix}${quote}${name} (variant)${quote}`;
  }
);

// Handle: it.each([...])('name %s', ...) — the second ('name' after the array
result = result.replace(
  /(it\.each\s*\([^)]*\)\s*\(\s*)(['"])((?:(?!\2).)*?)\2/g,
  (match, prefix, quote, name) => {
    if (!name.includes('(variant)')) {
      testCount++;
      return `${prefix}${quote}${name} (variant)${quote}`;
    }
    return match;
  }
);

console.log(`Renamed ${testCount} test names`);

// Step 2: Light user-content modifications
// Apply targeted rephrasing that won't break assertions
// ONLY modify longer user messages (>50 chars) to avoid breaking short-phrase routing
let modCount = 0;
const lines = result.split('\n');
const modifiedLines = lines.map((line, idx) => {
  // Match: { role: 'user', content: 'some text' }
  const m = line.match(/^(\s*\{?\s*role:\s*'user',\s*content:\s*')([^']{50,})('\s*\}?,?\s*)$/);
  if (!m) return line;
  
  const [, prefix, content, suffix] = m;
  let modified = content;
  
  // Skip content that has special patterns that are load-bearing for assertions
  if (/\{\{template|quantum breakpoints|web search|made-up|Use the headings/i.test(content)) return line;
  // Skip content that's a follow-up instruction (e.g. "Just the decision", "Short version")
  if (content.length < 80) return line;
  
  // Apply one modification per line, based on line index for determinism
  const mod = idx % 11;
  switch (mod) {
    case 0:
      // Add trailing period if missing
      if (!modified.endsWith('.') && !modified.endsWith('?') && !modified.endsWith('!') && modified.length > 20) {
        modified += '.';
        break;
      }
      break;
    case 1:
      // "What is" -> "What's" 
      if (/^What is /.test(modified)) {
        modified = modified.replace(/^What is /, "What\\'s ");
        break;
      }
      break;
    case 2:
      // Lowercase first letter if it's a greeting
      if (/^Hello\b/.test(modified)) {
        modified = 'hi';
        break;
      }
      break;
    case 3:
      // "How should" -> "How would"
      modified = modified.replace(/\bHow should\b/, 'How would');
      break;
    case 4:
      // "give me" -> "show me"  
      modified = modified.replace(/\bgive me\b/i, 'show me');
      break;
    case 5:
      // "explain" -> "describe"
      modified = modified.replace(/\bExplain\b/, 'Describe');
      modified = modified.replace(/\bexplain\b/, 'describe');
      break;
    case 6:
      // Add " clearly" before period
      if (modified.endsWith('.')) {
        modified = modified.slice(0, -1) + ' clearly.';
        break;
      }
      break;
    case 7:
      // "Should I" -> "Do you think I should"
      modified = modified.replace(/^Should I\b/, 'Do you think I should');
      break;
    case 8:
      // "Compare" -> "Contrast"
      modified = modified.replace(/^Compare\b/, 'Contrast');
      break;
    case 9:
      // Add question mark at end if it looks like a question
      if (/^(what|how|should|can|is|are|do|which|where|when|why)\b/i.test(modified) && !modified.endsWith('?')) {
        modified += '?';
        break;
      }
      break;
    case 10:
      // "I want" -> "I'd like"
      modified = modified.replace(/\bI want\b/, "I\\'d like");
      break;
  }

  if (modified !== content) {
    modCount++;
    return `${prefix}${modified}${suffix}`;
  }
  return line;
});

result = modifiedLines.join('\n');

// Add a header comment
result = `// AUTO-GENERATED variant tests — do not edit manually\n// Generated from vai-engine.test.ts with slight input variations\n\n${result}`;

writeFileSync(outPath, result, 'utf-8');

// Count tests in output
const itMatches = result.match(/\bit\s*\(/g) || [];
const itEachMatches = result.match(/\bit\.each/g) || [];
console.log(`Modified ${modCount} user content strings`);
console.log(`Output has ~${itMatches.length} it() calls + ${itEachMatches.length} it.each() calls`);
console.log(`Written to: ${outPath}`);
