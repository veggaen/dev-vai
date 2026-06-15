/* eslint-disable no-control-regex -- this module's purpose is matching ANSI control characters */
/** Remove terminal ANSI escape sequences from model/CLI output shown in UI. */
export function stripAnsi(value: string): string {
  return value
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\][^]*(?:|\\)/g, '')
    .replace(/\][^]*\\/g, '')
    .trim();
}
