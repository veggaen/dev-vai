const AUTH_SIGNALS = /\b(?:auth(?:entication)?|login|sign[\s-]?in|sign[\s-]?up|session|middleware|protected|account|user)\b/i;
const VISUAL_SIGNALS = /\b(?:spacing|typography|font|hero|headline|heading|cta|theme|color|palette|button|layout|landing|page|ui|visual|style|polish|refine|motions?|animations?|animate|kinetic|transitions?|entrance|reveal|body)\b/i;
const FILE_REFERENCE_SIGNALS = /(?:\b[\w./-]+\.(?:tsx|ts|jsx|js|css|scss|sass|json|html|md|py|sh|yml|yaml|toml|sql)\b|`[^`]+\.(?:tsx|ts|jsx|js|css|scss|sass|json|html|md|py|sh|yml|yaml|toml|sql)`)/i;
const PROJECT_REFERENCE_SIGNALS = /\b(?:this|current|existing|attached|same|active)\s+(?:app|project|preview|page|screen|component|repo|codebase|site|workspace)\b/i;
const PROJECT_ACTION_SIGNALS = /\b(?:fix|debug|repair|edit|change|update|improve|polish|refactor|restyle|wire|implement|connect|adjust|tweak|add|include|insert|ship|deploy|build|create|scaffold)\b/i;
const PROJECT_TARGET_SIGNALS = /\b(?:app|project|preview|page|screen|component|route|layout|file|files|code|codebase|repo|ui|ux|style|styles|css|hero|headline|heading|body|motions?|animations?|transitions?|entrance|reveal|auth|login|session|api|server|client|bug|error|issue|preview)\b/i;
const SANDBOX_REFERENCE_SIGNALS = /\b(?:sandbox|dev\s+server|localhost:\d+|running\s+app|live\s+preview|preview\s+server)\b/i;

const HIGH_PRIORITY_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /^package\.json$/i, weight: 140 },
  { pattern: /(?:^|\/)(?:src\/)?app\/layout\.(?:tsx|jsx|ts|js)$/i, weight: 105 },
  { pattern: /(?:^|\/)(?:src\/)?app\/page\.(?:tsx|jsx|ts|js)$/i, weight: 100 },
  { pattern: /(?:^|\/)src\/App\.(?:tsx|jsx|ts|js)$/i, weight: 100 },
  { pattern: /(?:^|\/)src\/main\.(?:tsx|jsx|ts|js)$/i, weight: 88 },
  { pattern: /(?:^|\/)(?:src\/)?app\/globals\.css$/i, weight: 84 },
  { pattern: /(?:^|\/)src\/styles\.(?:css|scss|sass)$/i, weight: 84 },
  { pattern: /(?:^|\/)middleware\.(?:ts|js)$/i, weight: 82 },
  { pattern: /(?:^|\/)(?:lib|src\/lib)\/auth\.(?:ts|tsx|js|jsx)$/i, weight: 78 },
  { pattern: /(?:^|\/)(?:components|src\/components)\/.*\.(?:tsx|jsx)$/i, weight: 52 },
];

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function scorePath(path: string, userPrompt: string): number {
  const normalized = normalizePath(path);
  let score = 0;

  for (const entry of HIGH_PRIORITY_PATTERNS) {
    if (entry.pattern.test(normalized)) score += entry.weight;
  }

  if (AUTH_SIGNALS.test(userPrompt)) {
    if (/package\.json$/i.test(normalized)) score += 40;
    if (/(?:^|\/)(?:src\/)?app\/layout\.(?:tsx|jsx|ts|js)$/i.test(normalized)) score += 36;
    if (/middleware\.(?:ts|js)$/i.test(normalized)) score += 36;
    if (/(?:auth|login|session|protected|account|user)/i.test(normalized)) score += 30;
  }

  if (VISUAL_SIGNALS.test(userPrompt)) {
    if (/(?:^|\/)(?:src\/)?app\/page\.(?:tsx|jsx|ts|js)$/i.test(normalized)) score += 34;
    if (/(?:^|\/)src\/App\.(?:tsx|jsx|ts|js)$/i.test(normalized)) score += 34;
    if (/(?:styles|globals)\.(?:css|scss|sass)$/i.test(normalized)) score += 30;
    if (/(?:hero|landing|page|home|index)/i.test(normalized)) score += 24;
  }

  if (/package-lock|pnpm-lock|yarn\.lock|node_modules|dist\/|build\/|coverage\//i.test(normalized)) score -= 120;

  return score;
}

export function pickSandboxContextPaths(files: string[], userPrompt: string, limit = 4): string[] {
  return files
    .map((path) => ({ path, score: scorePath(path, userPrompt) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map((entry) => entry.path);
}

export function shouldAttachSandboxContext(userPrompt: string): boolean {
  const prompt = userPrompt.trim();
  if (!prompt) return false;
  if (FILE_REFERENCE_SIGNALS.test(prompt)) return true;
  if (PROJECT_REFERENCE_SIGNALS.test(prompt)) return true;
  if (SANDBOX_REFERENCE_SIGNALS.test(prompt)) return true;
  if (PROJECT_ACTION_SIGNALS.test(prompt) && PROJECT_TARGET_SIGNALS.test(prompt)) return true;
  return false;
}
