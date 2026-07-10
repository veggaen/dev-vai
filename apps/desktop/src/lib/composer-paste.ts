/** Composer paste policy: preserve long prose prompts; attach file-like text. */

export const LARGE_PASTE_THRESHOLD = 500;

const CODE_PATTERNS: { test: RegExp; ext: string }[] = [
  { test: /^import\s+.*from\s+['"]|^export\s+(default\s+)?/m, ext: 'tsx' },
  { test: /^const\s+\w+\s*[:=]|^let\s+|^var\s+|^function\s+\w+\s*\(|=>\s*\{/m, ext: 'ts' },
  { test: /^<\w+[\s>]|<\/\w+>/m, ext: 'html' },
  { test: /^\.\w+\s*\{|^@media|^@import/m, ext: 'css' },
  { test: /^{[\s\n]*"/m, ext: 'json' },
  { test: /^#!/m, ext: 'sh' },
  { test: /^def\s+\w+|^class\s+\w+|^import\s+\w+$/m, ext: 'py' },
];

export function detectPastedFileExtension(text: string): string {
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test.test(text)) return pattern.ext;
  }
  return 'md';
}

export function shouldAttachTextPaste(text: string): boolean {
  if (text.length <= LARGE_PASTE_THRESHOLD) return false;
  if (detectPastedFileExtension(text) !== 'md') return true;

  // A long single-line instruction is still a chat prompt. Multi-line prose is
  // document-shaped and remains useful as a Markdown attachment.
  return text.split(/\r?\n/).length >= 4;
}
