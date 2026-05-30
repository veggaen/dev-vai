import { composeAppShell } from '../app-shell/index.js';

const TODO_TOP_MATTER = String.raw`
type Filter = 'all' | 'active' | 'completed';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

const STORAGE_KEY = 'vai.todo.v1';

function loadTodos(): Todo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Todo => (
      typeof item === 'object' && item !== null
      && typeof (item as Todo).id === 'string'
      && typeof (item as Todo).text === 'string'
      && typeof (item as Todo).completed === 'boolean'
      && typeof (item as Todo).createdAt === 'number'
    ));
  } catch { return []; }
}

function saveTodos(todos: Todo[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); } catch {}
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
`;

const TODO_SETUP = String.raw`  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { saveTodos(todos); }, [todos]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (editingId) editRef.current?.focus(); }, [editingId]);

  const visible = useMemo(() => {
    if (filter === 'active') return todos.filter((t) => !t.completed);
    if (filter === 'completed') return todos.filter((t) => t.completed);
    return todos;
  }, [todos, filter]);

  const activeCount = useMemo(() => todos.filter((t) => !t.completed).length, [todos]);
  const completedCount = todos.length - activeCount;

  function addTodo() {
    const text = draft.trim();
    if (!text) return;
    setTodos((c) => [{ id: makeId(), text, completed: false, createdAt: Date.now() }, ...c]);
    setDraft('');
  }
  function toggleTodo(id: string) { setTodos((c) => c.map((t) => t.id === id ? { ...t, completed: !t.completed } : t)); }
  function removeTodo(id: string) { setTodos((c) => c.filter((t) => t.id !== id)); }
  function startEditing(t: Todo) { setEditingId(t.id); setEditingDraft(t.text); }
  function commitEdit() {
    if (!editingId) return;
    const text = editingDraft.trim();
    if (!text) removeTodo(editingId);
    else setTodos((c) => c.map((t) => t.id === editingId ? { ...t, text } : t));
    setEditingId(null); setEditingDraft('');
  }
  function cancelEdit() { setEditingId(null); setEditingDraft(''); }
  function clearCompleted() { setTodos((c) => c.filter((t) => !t.completed)); }
  function toggleAll() {
    const shouldComplete = activeCount > 0;
    setTodos((c) => c.map((t) => ({ ...t, completed: shouldComplete })));
  }
`;

const TODO_BODY = String.raw`      <section className="td-composer">
        <button
          type="button"
          className="td-toggle-all"
          onClick={toggleAll}
          aria-label={activeCount > 0 ? 'Mark all complete' : 'Mark all active'}
        >{todos.length > 0 && activeCount === 0 ? '✓' : '○'}</button>
        <input
          ref={inputRef}
          type="text"
          className="td-input"
          placeholder="What needs doing?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
        />
        <button type="button" className="td-add" onClick={addTodo} disabled={!draft.trim()}>Add</button>
      </section>

      {todos.length === 0 ? (
        <div className="td-empty">
          <p>No todos yet. Add your first above.</p>
        </div>
      ) : (
        <>
          <ul className="td-list vai-card">
            {visible.map((t) => (
              <li key={t.id} className={t.completed ? 'td-item is-done' : 'td-item'}>
                <button
                  type="button"
                  className="td-check"
                  onClick={() => toggleTodo(t.id)}
                  aria-label={t.completed ? 'Mark active' : 'Mark complete'}
                >{t.completed ? '✓' : ''}</button>
                {editingId === t.id ? (
                  <input
                    ref={editRef}
                    type="text"
                    className="td-edit"
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    onBlur={commitEdit}
                  />
                ) : (
                  <span className="td-text" onDoubleClick={() => startEditing(t)}>{t.text}</span>
                )}
                <button type="button" className="td-del" onClick={() => removeTodo(t.id)} aria-label="Delete">×</button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="td-item is-empty"><span className="td-text muted">Nothing matches this filter.</span></li>
            )}
          </ul>

          <footer className="td-footer">
            <span className="td-count"><strong>{activeCount}</strong> {activeCount === 1 ? 'item' : 'items'} left</span>
            <div className="td-filters">
              {(['all', 'active', 'completed'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={filter === f ? 'td-filter is-active' : 'td-filter'}
                  onClick={() => setFilter(f)}
                >{f[0].toUpperCase() + f.slice(1)}</button>
              ))}
            </div>
            <button type="button" className="td-clear" onClick={clearCompleted} disabled={completedCount === 0}>Clear completed</button>
          </footer>
        </>
      )}

      <p className="td-hint">Double-click a todo to edit · Enter to save · Esc to cancel</p>`;

const TODO_CSS = String.raw`.td-composer {
  display: flex; gap: 8px; align-items: center;
  border-bottom: 1px solid var(--vai-border);
  padding: 4px 0 12px;
  transition: border-color 160ms ease;
}
.td-composer:focus-within { border-color: var(--vai-accent); }
.td-toggle-all {
  width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--vai-radius-sm);
  border: 1px solid var(--vai-border-strong); background: var(--vai-surface-2);
  color: var(--vai-muted); cursor: pointer; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  transition: all 140ms ease;
}
.td-toggle-all:hover { color: var(--vai-text); border-color: var(--vai-accent); }
.td-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--vai-text); font-size: 15px; padding: 8px 4px;
}
.td-input::placeholder { color: var(--vai-muted); }
.td-add {
  background: var(--vai-accent); color: white; border: none;
  border-radius: var(--vai-radius-sm); padding: 10px 18px;
  font-weight: 600; font-size: 14px; cursor: pointer;
  transition: filter 140ms ease, transform 140ms ease;
}
.td-add:hover:not(:disabled) { filter: brightness(1.15); }
.td-add:active:not(:disabled) { transform: scale(0.97); }
.td-add:disabled { opacity: 0.4; cursor: not-allowed; }

.td-empty { padding: 32px 8px; text-align: center; color: var(--vai-muted); }
.td-empty p { margin: 0; }

.td-list { list-style: none; margin: 0; padding: 0; overflow: hidden; }
.td-item {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  border-bottom: 1px solid var(--vai-border); transition: background 140ms ease;
}
.td-item:last-child { border-bottom: none; }
.td-item:hover { background: var(--vai-surface-2); }
.td-item.is-empty { color: var(--vai-muted); justify-content: center; }
.td-item.is-empty:hover { background: transparent; }
.td-check {
  width: 24px; height: 24px; flex-shrink: 0; border-radius: 50%;
  border: 1.5px solid var(--vai-border-strong); background: transparent;
  color: var(--vai-success); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; transition: all 140ms ease;
}
.td-check:hover { border-color: var(--vai-accent); }
.is-done .td-check { background: var(--vai-success); border-color: var(--vai-success); color: white; }
.td-text { flex: 1; font-size: 15px; line-height: 1.5; cursor: text; user-select: none; word-break: break-word; }
.td-text.muted { color: var(--vai-muted); }
.is-done .td-text { color: var(--vai-muted); text-decoration: line-through; }
.td-edit {
  flex: 1; background: var(--vai-bg); border: 1px solid var(--vai-accent);
  border-radius: 6px; color: var(--vai-text); font-size: 15px;
  padding: 6px 10px; outline: none;
}
.td-del {
  width: 28px; height: 28px; flex-shrink: 0; border-radius: 6px;
  border: none; background: transparent; color: var(--vai-muted);
  cursor: pointer; font-size: 22px; line-height: 1;
  opacity: 0; transition: all 140ms ease;
}
.td-item:hover .td-del { opacity: 1; }
.td-del:hover { background: rgba(240, 86, 111, 0.12); color: var(--vai-danger); }

.td-footer {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 12px 4px 0; font-size: 13px; color: var(--vai-muted);
  flex-wrap: wrap;
}
.td-count strong { color: var(--vai-text); font-weight: 600; }
.td-filters { display: flex; gap: 4px; }
.td-filter {
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--vai-muted); font-size: 13px; padding: 6px 12px; cursor: pointer;
  transition: all 140ms ease;
}
.td-filter:hover { color: var(--vai-text); border-color: var(--vai-border); }
.td-filter.is-active { color: var(--vai-accent); border-color: var(--vai-accent); }
.td-clear {
  background: transparent; border: none; color: var(--vai-muted);
  font-size: 13px; cursor: pointer; padding: 6px 8px; border-radius: 6px;
  transition: all 140ms ease;
}
.td-clear:hover:not(:disabled) { color: var(--vai-danger); }
.td-clear:disabled { opacity: 0.4; cursor: not-allowed; }
.td-hint { text-align: center; font-size: 12px; color: var(--vai-muted); margin: 8px 0 0; opacity: 0.7; }

@media (max-width: 560px) {
  .td-footer { flex-direction: column; align-items: stretch; gap: 10px; }
  .td-filters { justify-content: center; }
  .td-count, .td-clear { text-align: center; }
  .td-del { opacity: 1; }
}
`;

export function generateTodoApp(brief: string): string {
  void brief;
  return composeAppShell({
    packageName: 'vai-todo-app',
    title: 'Todos · Vai',
    hero: {
      badge: 'Your day, organized',
      title: 'Get things done.',
      accentWord: 'done',
      subtitle: 'A fast, distraction-free todo list that remembers everything for you. Add, edit, filter, and finish — your data lives in your browser.',
      pills: ['Inline editing', 'Smart filters', 'Offline-first', 'Keyboard-friendly'],
    },
    topMatter: TODO_TOP_MATTER,
    setupCode: TODO_SETUP,
    bodyJsx: TODO_BODY,
    extraCss: TODO_CSS,
  });
}

export function todoAppPlan(): string {
  return [
    "**Plan**",
    "",
    "Building a real Todo app:",
    "",
    "- Polished landing hero from Vai's shared design system (auto-responsive)",
    "- Add, complete, double-click to edit, delete · bulk toggle-all · clear completed",
    "- Filters: All / Active / Completed",
    "- Persists to `localStorage` — refresh-safe",
    "",
  ].join('\n');
}
