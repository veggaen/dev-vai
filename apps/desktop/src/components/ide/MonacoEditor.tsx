/**
 * Lazy Monaco editor — syntax highlight for workspace files.
 */

import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', css: 'css', html: 'html', md: 'markdown', rs: 'rust',
  py: 'python', sh: 'shell', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sql: 'sql', xml: 'xml', vue: 'html', go: 'go',
};

function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'plaintext';
}

interface MonacoEditorProps {
  readonly path: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly readOnly?: boolean;
}

export function MonacoEditor({ path, value, onChange, readOnly }: MonacoEditorProps) {
  const onMount: OnMount = (ed: editor.IStandaloneCodeEditor) => {
    ed.focus();
  };

  return (
    <Editor
      height="100%"
      language={languageForPath(path)}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={onMount}
      theme="vs-dark"
      options={{
        readOnly: readOnly ?? false,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: 'line',
        bracketPairColorization: { enabled: true },
      }}
      loading={
        <div className="flex h-full items-center justify-center text-xs text-[color:var(--chat-muted)]">
          Loading editor…
        </div>
      }
    />
  );
}

export default MonacoEditor;