import { runLocalVisualLayoutAudit } from '../packages/runtime/src/sandbox/visual-layout-audit.js';

function parseArgs(argv: readonly string[]): { url: string; screenshotDir?: string } {
  const url = argv.find((arg) => /^https?:\/\//i.test(arg)) ?? 'http://localhost:4100';
  const screenshotFlag = argv.findIndex((arg) => arg === '--screenshot-dir');
  const screenshotDir = screenshotFlag >= 0 ? argv[screenshotFlag + 1] : undefined;
  return { url, screenshotDir };
}

const { url, screenshotDir } = parseArgs(process.argv.slice(2));
const report = await runLocalVisualLayoutAudit(url, { screenshotDir });
console.log(JSON.stringify(report, null, 2));
if (report.verdict === 'fail') process.exitCode = 2;
