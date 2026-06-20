import type { ProcessNode } from './ProcessTree.logic.js';

export interface ProcessNodeSnapshot {
  readonly label: string;
  readonly kind?: string;
  readonly status: ProcessNode['status'];
  readonly detail?: string;
  readonly note?: string;
  readonly tone?: string;
  readonly children?: readonly ProcessNodeSnapshot[];
}

export function nodeToSnapshot(node: ProcessNode): ProcessNodeSnapshot {
  const snap: ProcessNodeSnapshot = {
    label: node.label,
    kind: node.kind,
    status: node.status,
    tone: node.tone,
    detail: node.detail?.trim() || undefined,
    note: node.note?.trim() || undefined,
  };
  if (node.children.length > 0) {
    return { ...snap, children: node.children.map(nodeToSnapshot) };
  }
  return snap;
}

export function nodesToSnapshot(nodes: readonly ProcessNode[]): ProcessNodeSnapshot[] {
  return nodes.map(nodeToSnapshot);
}

function snapshotLines(node: ProcessNodeSnapshot, depth: number): string[] {
  const pad = '  '.repeat(depth);
  const status = node.status === 'running' ? '…' : node.status === 'bad' ? '!' : '✓';
  const lines = [`${pad}- [${status}] ${node.label}`];
  if (node.detail) lines.push(`${pad}  detail: ${node.detail}`);
  if (node.note) {
    for (const line of node.note.split('\n')) {
      lines.push(`${pad}  ${line}`);
    }
  }
  for (const child of node.children ?? []) {
    lines.push(...snapshotLines(child, depth + 1));
  }
  return lines;
}

/** Human-readable trace for pasting into issues / worker handoffs. */
export function snapshotsToMarkdown(nodes: readonly ProcessNodeSnapshot[], title = 'Vai process trace'): string {
  const body = nodes.flatMap((node) => snapshotLines(node, 0));
  return `# ${title}\n\n${body.join('\n')}\n`;
}

export function snapshotsToJson(data: ProcessNodeSnapshot | readonly ProcessNodeSnapshot[]): string {
  return JSON.stringify(data, null, 2);
}

export async function copyProcessText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type ProcessCopyScope = 'node' | 'branch' | 'tree';

export function buildCopyPayload(
  scope: ProcessCopyScope,
  node: ProcessNode,
  allNodes: readonly ProcessNode[],
): { markdown: string; json: string } {
  if (scope === 'tree') {
    const snaps = nodesToSnapshot(allNodes);
    return {
      markdown: snapshotsToMarkdown(snaps),
      json: snapshotsToJson(snaps),
    };
  }
  const snap = nodeToSnapshot(node);
  if (scope === 'branch') {
    return {
      markdown: snapshotsToMarkdown([snap], snap.label),
      json: snapshotsToJson(snap),
    };
  }
  const leaf: ProcessNodeSnapshot = { ...snap, children: undefined };
  return {
    markdown: snapshotsToMarkdown([leaf], leaf.label),
    json: snapshotsToJson(leaf),
  };
}
