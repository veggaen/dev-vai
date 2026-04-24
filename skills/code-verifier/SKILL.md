---
name: code-verifier
description: Verify generated code before presenting to user. Checks syntax, imports, types, runtime patterns, and dependency completeness.
version: 1.0.0
author: vai
trust: verified
triggers:
  - verify code
  - check code
  - validate
  - does this compile
  - will this work
  - test this
  - lint
tools:
  - code-runner
permissions:
  - local-files
---

# Code Verifier Skill

## Purpose
Catch problems in generated code before the user sees it. Fast, deterministic checks that don't require running the full program.

## Checks

### 1. Syntax validity
- TypeScript/JavaScript: balanced brackets, braces, parens; valid syntax
- No bare async/await outside async function
- No duplicate variable declarations in same scope
- Template literals: no unmatched backticks

### 2. Import resolution
- All imports exist in package.json (dependencies or devDependencies)
- Relative imports: file must exist at the expected path
- Named imports match the module's exports (if checkable)
- `node:` protocol imports require Node ≥ 14.18

### 3. Type consistency (TypeScript)
- Obvious mismatches: assigning string to number
- Non-null assertions (!.) on values that are probably null
- Missing `await` on Promise-returning functions
- Wrong number of arguments to known functions

### 4. Runtime patterns
- Missing `await` on `fs.readFile`, `fetch`, database calls
- `.map()` callback that returns nothing (implicit undefined)
- Event handler added inside loop (common memory leak)
- `setTimeout` with string argument (legacy, avoid)
- `JSON.parse` without try/catch

### 5. Dependency completeness
- New imports not yet in package.json → flag with `npm install X` suggestion
- Version conflicts: import uses a feature not in the installed version range

## Severity levels
| Level | Meaning |
|---|---|
| error | Will definitely fail or produce wrong output |
| warning | Might fail or produce unexpected behavior |
| suggestion | Style, best practice, or minor improvement |

## Output format
```typescript
{
  valid: boolean,
  errors: Array<{ line?: number, message: string, severity: 'error' }>,
  warnings: Array<{ line?: number, message: string, severity: 'warning' }>,
  suggestions: Array<{ line?: number, message: string, severity: 'suggestion' }>,
  missingPackages: string[],
  summary: string,
}
```

## Behavior when valid
If valid with no errors: return `{ valid: true, summary: "Code looks correct." }`
Do not list empty arrays.

## Notes
- Run this skill automatically before presenting code snippets > 10 lines
- Do not block on warnings — only block on errors
- Suggestions are informational only
