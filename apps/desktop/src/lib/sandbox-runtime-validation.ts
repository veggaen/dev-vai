const BROWSER_RUNTIME_ERROR_PATTERNS = [
  /\[browser\].*\[uncaught\]/i,
  /\[browser\].*\[unhandledrejection\]/i,
  /\[browser\].*the above error occurred/i,
  /\[browser\].*failed to load resource/i,
  /\[browser\].*\b(?:typeerror|referenceerror|syntaxerror|rangeerror|evalerror|urierror)\b/i,
  /\[browser\].*\berror:\b/i,
];

const BROWSER_RUNTIME_IGNORE_PATTERNS = [
  /download the react devtools/i,
  /\[vite\]\s+connected/i,
  /\[vite\]\s+connecting/i,
  /consider adding an error boundary/i,
];

export function extractBrowserRuntimeErrors(logs: readonly string[]): string[] {
  return logs.filter((line) => {
    if (!/\[browser\]/i.test(line)) return false;
    if (BROWSER_RUNTIME_IGNORE_PATTERNS.some((pattern) => pattern.test(line))) return false;
    return BROWSER_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(line));
  });
}