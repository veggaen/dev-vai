import { useCallback, useState, type ReactNode } from 'react';
import { Check, Copy, GitBranch, Layers } from 'lucide-react';
import type { ProcessNode } from './ProcessTree.logic.js';
import { buildCopyPayload, copyProcessText, type ProcessCopyScope } from './ProcessTree.copy.js';

interface ProcessTreeCopyActionsProps {
  readonly node: ProcessNode;
  readonly allNodes: readonly ProcessNode[];
  /** Show "copy full tree" control (top-level rows only). */
  readonly showTreeCopy?: boolean;
  readonly compact?: boolean;
}

const COPY_RESET_MS = 1600;

export function ProcessTreeCopyActions({
  node,
  allNodes,
  showTreeCopy = false,
  compact = false,
}: ProcessTreeCopyActionsProps) {
  const [copied, setCopied] = useState<ProcessCopyScope | null>(null);
  const hasBranch = node.children.length > 0;

  const copy = useCallback(async (scope: ProcessCopyScope, format: 'markdown' | 'json') => {
    const payload = buildCopyPayload(scope, node, allNodes);
    const text = format === 'markdown' ? payload.markdown : payload.json;
    const ok = await copyProcessText(text);
    if (ok) {
      setCopied(scope);
      window.setTimeout(() => setCopied(null), COPY_RESET_MS);
    }
  }, [allNodes, node]);

  const btnClass = compact
    ? 'process-tree__copy-btn process-tree__copy-btn--sm'
    : 'process-tree__copy-btn';

  const renderBtn = (
    scope: ProcessCopyScope,
    label: string,
    icon: ReactNode,
    title: string,
  ) => (
    <button
      key={scope}
      type="button"
      className={btnClass}
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void copy(scope, event.shiftKey ? 'json' : 'markdown');
      }}
    >
      {copied === scope ? <Check className="h-3 w-3" aria-hidden="true" /> : icon}
      {!compact && <span>{label}</span>}
    </button>
  );

  return (
    <div
      className="process-tree__copy-actions"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {renderBtn('node', 'Step', <Copy className="h-3 w-3" aria-hidden="true" />, 'Copy this step (Shift+click for JSON)')}
      {hasBranch && renderBtn(
        'branch',
        'Branch',
        <GitBranch className="h-3 w-3" aria-hidden="true" />,
        'Copy step and nested details (Shift+click for JSON)',
      )}
      {showTreeCopy && renderBtn(
        'tree',
        'Tree',
        <Layers className="h-3 w-3" aria-hidden="true" />,
        'Copy full process tree (Shift+click for JSON)',
      )}
    </div>
  );
}
