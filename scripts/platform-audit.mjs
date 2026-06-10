#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const profile = argValue('--profile', 'static');
const configPath = resolve(root, argValue('--config', 'eval/platform-audit/controls.json'));
const outputDir = resolve(root, argValue('--out-dir', 'Temporary_files/platform-audit'));
const failOn = argValue('--fail-on', 'critical');

function workspacePath(path) {
  return resolve(root, path);
}

async function listFiles(dir, excludedDirs = new Set()) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && excludedDirs.has(entry.name)) return [];
    return entry.isDirectory() ? listFiles(path, excludedDirs) : [path];
  }));
  return nested.flat();
}

function result(control, status, summary, details = []) {
  return {
    id: control.id,
    category: control.category,
    severity: control.severity,
    status,
    summary,
    details,
    remediation: control.remediation,
  };
}

function patternsMatch(content, control) {
  const flags = control.flags ?? '';
  const matches = (pattern) => new RegExp(pattern, flags).test(content);
  const missing = (control.allPatterns ?? []).filter((pattern) => !matches(pattern));
  const forbidden = (control.absentPatterns ?? []).filter(matches);
  const anyPatterns = control.anyPatterns ?? [];
  const missingAny = anyPatterns.length > 0 && !anyPatterns.some(matches);
  return { missing, forbidden, missingAny };
}

async function runFileContent(control) {
  const path = workspacePath(control.path);
  if (!existsSync(path)) return result(control, 'fail', `Missing file: ${control.path}`);
  const content = await readFile(path, 'utf8');
  const { missing, forbidden, missingAny } = patternsMatch(content, control);
  const details = [
    ...missing.map((pattern) => `missing pattern: ${pattern}`),
    ...forbidden.map((pattern) => `forbidden pattern: ${pattern}`),
    ...(missingAny ? [`none of the accepted patterns were found: ${control.anyPatterns.join(', ')}`] : []),
  ];
  return details.length
    ? result(control, 'fail', `Content control failed: ${control.path}`, details)
    : result(control, 'pass', `Content control passed: ${control.path}`);
}

async function runRootArtifacts(control) {
  const entries = await readdir(root, { withFileTypes: true });
  const patterns = control.patterns.map((pattern) => new RegExp(pattern));
  const artifacts = entries
    .filter((entry) => entry.isFile() && patterns.some((pattern) => pattern.test(entry.name)))
    .map((entry) => entry.name)
    .sort();
  return artifacts.length
    ? result(control, 'fail', `${artifacts.length} scratch artifact(s) remain at repository root`, artifacts)
    : result(control, 'pass', 'No matching scratch artifacts remain at repository root');
}

async function runMaxLines(control) {
  const extensions = new Set(control.extensions);
  const excludedDirs = new Set(control.excludeDirs ?? []);
  const files = (await Promise.all(control.roots.map((dir) => listFiles(workspacePath(dir), excludedDirs)))).flat();
  const measured = [];
  for (const file of files) {
    if (!extensions.has(extname(file))) continue;
    const info = await stat(file);
    if (info.size === 0) continue;
    const content = await readFile(file, 'utf8');
    measured.push({ path: relative(root, file).replaceAll('\\', '/'), lines: content.split(/\r?\n/).length });
  }
  measured.sort((a, b) => b.lines - a.lines);
  const failures = measured.filter((entry) => entry.lines > control.maxLines);
  const warnings = measured.filter((entry) => entry.lines > control.warnLines);
  const details = warnings.slice(0, 15).map((entry) => `${entry.lines} lines: ${entry.path}`);
  return failures.length
    ? result(control, 'fail', `${failures.length} source file(s) exceed ${control.maxLines} lines`, details)
    : warnings.length
      ? result(control, 'warn', `${warnings.length} source file(s) exceed ${control.warnLines} lines`, details)
      : result(control, 'pass', `No source files exceed ${control.warnLines} lines`);
}

async function runRouteInventory(control) {
  const files = await listFiles(workspacePath(control.root));
  const routePattern = /app\.(get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const routes = [];
  for (const file of files.filter((path) => extname(path) === '.ts')) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(routePattern)) {
      routes.push(`${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  routes.sort();
  return result(control, 'info', `${routes.length} runtime route(s) inventoried`, routes);
}

function commandInvocation(command, commandArgs) {
  if (process.platform !== 'win32' || !['corepack', 'pnpm', 'npx'].includes(command)) {
    return { command, commandArgs };
  }

  const quoted = [command, ...commandArgs]
    .map((value) => (/^[\w@:/.=+-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`))
    .join(' ');
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    commandArgs: ['/d', '/s', '/c', quoted],
  };
}

async function runCommand(control) {
  const [command, ...commandArgs] = control.command;
  const startedAt = Date.now();
  return new Promise((resolveResult) => {
    const invocation = commandInvocation(command, commandArgs);
    let child;
    try {
      child = spawn(invocation.command, invocation.commandArgs, {
        cwd: root,
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      resolveResult(result(control, 'fail', `Command could not start: ${control.command.join(' ')}`, [error.message]));
      return;
    }
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, control.timeoutMs ?? 120000);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveResult(result(control, 'fail', `Command could not start: ${control.command.join(' ')}`, [error.message]));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;
      const details = output.trim().split(/\r?\n/).slice(-30);
      if (timedOut) {
        resolveResult(result(control, 'fail', `Command timed out after ${elapsedMs}ms`, details));
      } else if (code !== 0) {
        resolveResult(result(control, 'fail', `Command exited ${code} after ${elapsedMs}ms`, details));
      } else {
        resolveResult(result(control, 'pass', `Command passed in ${elapsedMs}ms`, details.slice(-5)));
      }
    });
  });
}

async function runControl(control) {
  switch (control.kind) {
    case 'file-exists':
      return existsSync(workspacePath(control.path))
        ? result(control, 'pass', `Found ${control.path}`)
        : result(control, 'fail', `Missing ${control.path}`);
    case 'any-file-exists': {
      const found = control.paths.filter((path) => existsSync(workspacePath(path)));
      return found.length
        ? result(control, 'pass', `Found ${found.join(', ')}`)
        : result(control, 'fail', `Missing all accepted files`, control.paths);
    }
    case 'file-content':
      return runFileContent(control);
    case 'root-artifacts':
      return runRootArtifacts(control);
    case 'max-lines':
      return runMaxLines(control);
    case 'route-inventory':
      return runRouteInventory(control);
    case 'command':
      return runCommand(control);
    default:
      return result(control, 'fail', `Unknown control kind: ${control.kind}`);
  }
}

function summarize(results) {
  return results.reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
    return summary;
  }, {});
}

function markdownReport(report) {
  const lines = [
    '# VAI Platform Audit',
    '',
    `- Profile: \`${report.profile}\``,
    `- Created: \`${report.createdAt}\``,
    `- Controls: ${report.results.length}`,
    `- Summary: ${Object.entries(report.summary).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    '',
    '## Findings',
    '',
  ];
  for (const entry of report.results) {
    lines.push(`### ${entry.status.toUpperCase()} ${entry.id}`);
    lines.push('');
    lines.push(`- Category: \`${entry.category}\``);
    lines.push(`- Severity: \`${entry.severity}\``);
    lines.push(`- Summary: ${entry.summary}`);
    if (entry.remediation) lines.push(`- Remediation: ${entry.remediation}`);
    if (entry.details.length) {
      lines.push('- Details:');
      for (const detail of entry.details.slice(0, 30)) lines.push(`  - \`${detail}\``);
    }
    lines.push('');
  }
  if (report.trend.length) {
    lines.push('## Trend');
    lines.push('');
    for (const item of report.trend) lines.push(`- \`${item.id}\`: ${item.before} -> ${item.after}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function readPreviousReport() {
  if (!existsSync(outputDir)) return null;
  const files = (await readdir(outputDir))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse();
  if (!files.length) return null;
  return JSON.parse(await readFile(join(outputDir, files[0]), 'utf8'));
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const controls = config.controls.filter((control) => control.profiles.includes(profile));
if (!controls.length) throw new Error(`No controls configured for profile "${profile}"`);

console.log(`[audit] Running ${controls.length} ${profile} control(s)...`);
const results = [];
for (const control of controls) {
  const entry = await runControl(control);
  results.push(entry);
  console.log(`[audit] ${entry.status.toUpperCase().padEnd(4)} ${entry.id}: ${entry.summary}`);
}

const previous = await readPreviousReport();
const previousStatuses = new Map((previous?.results ?? []).map((entry) => [entry.id, entry.status]));
const trend = results
  .filter((entry) => previousStatuses.has(entry.id) && previousStatuses.get(entry.id) !== entry.status)
  .map((entry) => ({ id: entry.id, before: previousStatuses.get(entry.id), after: entry.status }));
const createdAt = new Date().toISOString();
const report = { version: config.version, profile, createdAt, summary: summarize(results), trend, results };
const stamp = createdAt.replace(/[:.]/g, '-');

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(outputDir, `${stamp}.md`), markdownReport(report));

console.log(`[audit] Report: ${relative(root, join(outputDir, `${stamp}.md`))}`);
const threshold = failOn === 'none' ? Number.POSITIVE_INFINITY : severityRank[failOn];
const blocking = results.filter((entry) => entry.status === 'fail' && severityRank[entry.severity] >= threshold);
if (blocking.length) {
  console.error(`[audit] Blocking failures (${failOn}+): ${blocking.map((entry) => entry.id).join(', ')}`);
  process.exitCode = 1;
}
