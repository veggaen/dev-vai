#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') {
    process.exitCode = 0;
    process.exit(0);
  }
  throw error;
});

process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

function parseArgs(argv) {
  const options = {
    apply: false,
    minMb: 100,
    keep: 5,
    workspacePath: process.cwd(),
    workspaceId: null,
    storageRoot: null,
    archiveRoot: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--min-mb' && next) {
      options.minMb = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--keep' && next) {
      options.keep = Number(next);
      index += 1;
      continue;
    }
    if (arg === '--workspace-path' && next) {
      options.workspacePath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--workspace-id' && next) {
      options.workspaceId = next;
      index += 1;
      continue;
    }
    if (arg === '--storage-root' && next) {
      options.storageRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--archive-root' && next) {
      options.archiveRoot = path.resolve(next);
      index += 1;
      continue;
    }
  }

  if (!Number.isFinite(options.minMb) || options.minMb < 0) {
    throw new Error('--min-mb must be a non-negative number');
  }
  if (!Number.isInteger(options.keep) || options.keep < 0) {
    throw new Error('--keep must be a non-negative integer');
  }

  return options;
}

function resolveDefaultStorageRoot() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User', 'workspaceStorage');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Code', 'User', 'workspaceStorage');
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function maybePathFromUri(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  if (value.startsWith('file://')) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  return value;
}

function extractWorkspacePaths(data) {
  const paths = [];
  const pushPath = (value) => {
    const resolved = maybePathFromUri(value);
    if (resolved) {
      paths.push(resolved);
    }
  };

  pushPath(data.folder);
  pushPath(data.folderUri);

  if (Array.isArray(data.folders)) {
    for (const entry of data.folders) {
      if (typeof entry === 'string') {
        pushPath(entry);
      } else if (entry && typeof entry === 'object') {
        pushPath(entry.path);
        pushPath(entry.uri);
      }
    }
  }

  return paths;
}

function matchScore(candidate, target) {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedTarget = normalizePath(target);
  if (normalizedCandidate === normalizedTarget) {
    return 3;
  }
  if (normalizedTarget.startsWith(`${normalizedCandidate}/`) || normalizedCandidate.startsWith(`${normalizedTarget}/`)) {
    return 2;
  }
  const targetBase = `/${path.basename(normalizedTarget)}`;
  if (normalizedCandidate.endsWith(targetBase)) {
    return 1;
  }
  return 0;
}

function findWorkspaceDirectory(storageRoot, workspaceRoot, workspaceId) {
  if (workspaceId) {
    const directPath = path.join(storageRoot, workspaceId, 'chatSessions');
    if (!fs.existsSync(directPath)) {
      throw new Error(`Workspace id ${workspaceId} does not have a chatSessions directory`);
    }
    return { workspaceId, chatDir: directPath };
  }

  let bestMatch = null;
  for (const entry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const workspaceJson = path.join(storageRoot, entry.name, 'workspace.json');
    const chatDir = path.join(storageRoot, entry.name, 'chatSessions');
    if (!fs.existsSync(workspaceJson) || !fs.existsSync(chatDir)) {
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(workspaceJson, 'utf8'));
      for (const workspacePath of extractWorkspacePaths(data)) {
        const score = matchScore(workspacePath, workspaceRoot);
        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { workspaceId: entry.name, chatDir, score };
        }
      }
    } catch {
      // Ignore malformed workspace descriptors.
    }
  }

  if (!bestMatch) {
    throw new Error(`Could not find a VS Code workspaceStorage entry for ${workspaceRoot}`);
  }

  return bestMatch;
}

function readTitle(filePath, fileSize) {
  const chunkSize = Math.min(fileSize, 512 * 1024);
  const buffer = Buffer.alloc(chunkSize);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, buffer, 0, chunkSize, 0);
  } finally {
    fs.closeSync(handle);
  }

  let customTitle = null;
  let draft = null;
  for (const line of buffer.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      const keyPath = Array.isArray(entry.k) ? entry.k.join('.') : '';
      if (!customTitle && entry.kind === 0 && typeof entry.v?.customTitle === 'string') {
        customTitle = entry.v.customTitle.trim();
      }
      if (!customTitle && entry.kind === 1 && keyPath === 'customTitle' && typeof entry.v === 'string') {
        customTitle = entry.v.trim();
      }
      if (!draft && entry.kind === 1 && keyPath === 'inputState.inputText' && typeof entry.v === 'string') {
        draft = entry.v.trim();
      }
      if (!draft && entry.kind === 3 && typeof entry.v?.request?.message === 'string') {
        draft = entry.v.request.message.trim();
      }
      if (customTitle && draft) {
        break;
      }
    } catch {
      // Ignore malformed JSONL lines.
    }
  }

  const value = customTitle || draft || '(unknown)';
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

function uniqueDestination(filePath) {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const name = path.basename(filePath, extension);
  return path.join(directory, `${name}-${Date.now()}${extension}`);
}

function moveFile(sourcePath, destinationPath) {
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EXDEV') {
      fs.copyFileSync(sourcePath, destinationPath);
      fs.unlinkSync(sourcePath);
      return;
    }
    throw error;
  }
}

function formatRow(file) {
  return `${file.name}  ${file.sizeMb.toFixed(1)}MB  ${file.modifiedAt.toISOString().slice(0, 16)}  "${file.title}"`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const storageRoot = options.storageRoot || resolveDefaultStorageRoot();
  if (!fs.existsSync(storageRoot)) {
    throw new Error(`workspaceStorage root not found: ${storageRoot}`);
  }

  const { workspaceId, chatDir } = findWorkspaceDirectory(storageRoot, options.workspacePath, options.workspaceId);
  const archiveRoot = options.archiveRoot || path.join(path.dirname(storageRoot), 'workspaceStorage-archive', workspaceId, 'chatSessions');

  const files = fs.readdirSync(chatDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(chatDir, name);
      const stats = fs.statSync(fullPath);
      return {
        name,
        fullPath,
        modifiedAt: stats.mtime,
        sizeMb: stats.size / (1024 * 1024),
        title: readTitle(fullPath, stats.size),
      };
    })
    .filter((file) => file.sizeMb >= options.minMb)
    .sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());

  if (files.length === 0) {
    console.log(`No chat session files >= ${options.minMb}MB found in ${chatDir}`);
    return;
  }

  const keep = files.slice(0, options.keep);
  const archive = files.slice(options.keep).sort((left, right) => right.sizeMb - left.sizeMb);

  console.log(`Workspace id: ${workspaceId}`);
  console.log(`Chat dir: ${chatDir}`);
  console.log(`Archive dir: ${archiveRoot}`);
  console.log(`Matching files >= ${options.minMb}MB: ${files.length}`);
  console.log(`Keeping newest matching files: ${keep.length}`);

  if (keep.length > 0) {
    console.log('\nKeeping:');
    for (const file of keep) {
      console.log(`  ${formatRow(file)}`);
    }
  }

  if (archive.length === 0) {
    console.log('\nNo archive candidates after keep threshold.');
    return;
  }

  const totalArchiveMb = archive.reduce((sum, file) => sum + file.sizeMb, 0);
  const verb = options.apply ? 'Archiving' : 'Would archive';
  console.log(`\n${verb}:`);
  for (const file of archive) {
    console.log(`  ${formatRow(file)}`);
  }
  console.log(`\nTotal archive size: ${totalArchiveMb.toFixed(1)}MB`);

  if (!options.apply) {
    console.log('\nDry run only. Re-run with --apply to move these files out of VS Code workspaceStorage.');
    return;
  }

  fs.mkdirSync(archiveRoot, { recursive: true });
  for (const file of archive) {
    const destination = uniqueDestination(path.join(archiveRoot, file.name));
    moveFile(file.fullPath, destination);
  }

  console.log(`\nMoved ${archive.length} files to ${archiveRoot}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}