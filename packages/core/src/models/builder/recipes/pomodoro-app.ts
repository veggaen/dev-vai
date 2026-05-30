import { composeAppShell } from '../app-shell/index.js';

const POMODORO_TOP_MATTER = String.raw`
import type { FormEvent } from 'react';

type Phase = 'work' | 'short' | 'long';
type Settings = { work: number; short: number; long: number; cyclesBeforeLong: number };
type FocusTask = { id: number; title: string; done: boolean };
type SessionHistory = { id: number; taskTitle: string; minutes: number; completedAt: string };

const SETTINGS_KEY = 'vai.pomodoro.settings.v1';
const STATS_KEY = 'vai.pomodoro.stats.v1';
const TASKS_KEY = 'vai.pomodoro.tasks.v1';
const HISTORY_KEY = 'vai.pomodoro.history.v1';
const DEFAULT_SETTINGS: Settings = { work: 25, short: 5, long: 15, cyclesBeforeLong: 4 };
const DEFAULT_TASKS: FocusTask[] = [
  { id: 1, title: 'Shape the smallest useful feature', done: false },
  { id: 2, title: 'Verify the app in preview', done: false },
  { id: 3, title: 'Write the next handoff note', done: true },
];

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function writeStored<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function beep() {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 660; gain.gain.value = 0.22;
    osc.start(); osc.stop(ctx.currentTime + 0.28);
    setTimeout(() => ctx.close(), 360);
  } catch {}
}
`;

const POMODORO_SETUP = String.raw`  const [settings, setSettings] = useState<Settings>(() => readStored(SETTINGS_KEY, DEFAULT_SETTINGS));
  const [phase, setPhase] = useState<Phase>('work');
  const [remaining, setRemaining] = useState<number>(() => readStored(SETTINGS_KEY, DEFAULT_SETTINGS).work * 60);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState<number>(() => readStored(STATS_KEY, 0));
  const [tasks, setTasks] = useState<FocusTask[]>(() => readStored(TASKS_KEY, DEFAULT_TASKS).slice(0, 8));
  const [activeTaskId, setActiveTaskId] = useState<number>(() => readStored(TASKS_KEY, DEFAULT_TASKS).find((task) => !task.done)?.id ?? 1);
  const [taskDraft, setTaskDraft] = useState('');
  const [history, setHistory] = useState<SessionHistory[]>(() => readStored(HISTORY_KEY, [] as SessionHistory[]).slice(0, 10));

  useEffect(() => { writeStored(SETTINGS_KEY, settings); }, [settings]);
  useEffect(() => { writeStored(STATS_KEY, completed); }, [completed]);
  useEffect(() => { writeStored(TASKS_KEY, tasks); }, [tasks]);
  useEffect(() => { writeStored(HISTORY_KEY, history); }, [history]);

  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? tasks.find((task) => !task.done);
  const openTasks = tasks.filter((task) => !task.done);
  const streakDays = new Set(history.map((entry) => entry.completedAt)).size;
  const phaseLabel = phase === 'work' ? 'Focus' : phase === 'short' ? 'Short break' : 'Long break';
  const phaseDuration = phase === 'work' ? settings.work : phase === 'short' ? settings.short : settings.long;
  const progress = phaseDuration > 0 ? 1 - remaining / (phaseDuration * 60) : 0;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r > 1) return r - 1;
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (remaining !== 0) return;
    if (!running) return;
    beep();
    setRunning(false);
    if (phase === 'work') {
      const nextCompleted = completed + 1;
      setCompleted(nextCompleted);
      setHistory((current) => [{
        id: Date.now(),
        taskTitle: activeTask?.title ?? 'Untitled focus session',
        minutes: settings.work,
        completedAt: new Date().toLocaleDateString(),
      }, ...current].slice(0, 10));
      const nextPhase: Phase = nextCompleted % settings.cyclesBeforeLong === 0 ? 'long' : 'short';
      setPhase(nextPhase);
      setRemaining((nextPhase === 'long' ? settings.long : settings.short) * 60);
    } else {
      setPhase('work');
      setRemaining(settings.work * 60);
    }
  }, [remaining, running, phase, settings, completed, activeTask]);

  function toggle() { setRunning((r) => !r); }
  function reset() {
    setRunning(false);
    setRemaining(phaseDuration * 60);
  }
  function skipPhase() {
    setRunning(false);
    if (phase === 'work') {
      setPhase('short');
      setRemaining(settings.short * 60);
    } else {
      setPhase('work');
      setRemaining(settings.work * 60);
    }
  }
  function setPhaseDuration(p: Phase, mins: number) {
    const clamped = Math.max(1, Math.min(90, Math.round(mins)));
    setSettings((s) => ({ ...s, [p]: clamped } as Settings));
    if (p === phase) {
      setRunning(false);
      setRemaining(clamped * 60);
    }
  }
  function resetStats() { setCompleted(0); }
  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = taskDraft.trim();
    if (!title) return;
    const nextTask = { id: Date.now(), title, done: false };
    setTasks((current) => [nextTask, ...current].slice(0, 8));
    setActiveTaskId(nextTask.id);
    setTaskDraft('');
  }
  function toggleTask(id: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  }
`;

const POMODORO_BODY = String.raw`      <section className={'pd-timer vai-card pd-phase-' + phase}>
        <div className="pd-phase-row">
          <span className="pd-phase-label">{phaseLabel}</span>
          <span className="pd-cycle">Cycle {(completed % settings.cyclesBeforeLong) + (phase === 'work' ? 1 : 0)} / {settings.cyclesBeforeLong}</span>
        </div>
        <div className="pd-time">{fmt(remaining)}</div>
        <div className="pd-progress" aria-hidden="true">
          <div className="pd-progress-fill" style={{ width: (progress * 100).toFixed(2) + '%' }} />
        </div>
        <div className="pd-controls">
          <button type="button" className="pd-btn pd-btn-primary" onClick={toggle}>
            {running ? 'Pause' : remaining === phaseDuration * 60 ? 'Start' : 'Resume'}
          </button>
          <button type="button" className="pd-btn" onClick={reset}>Reset</button>
          <button type="button" className="pd-btn" onClick={skipPhase}>Skip</button>
        </div>
      </section>

      <section className="pd-task-board vai-card">
        <div className="pd-board-head">
          <div>
            <h2 className="pd-section-title">Tasks</h2>
            <p className="pd-board-copy">Pick the task this focus session should protect.</p>
          </div>
          <span className="pd-streak">Streak {streakDays || 0}d</span>
        </div>
        <form className="pd-task-form" onSubmit={addTask}>
          <input
            value={taskDraft}
            onChange={(event) => setTaskDraft(event.target.value)}
            placeholder="Add a tiny focus task"
          />
          <button type="submit" className="pd-btn pd-btn-primary">Add task</button>
        </form>
        <div className="pd-task-list">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={'pd-task ' + (task.id === activeTask?.id ? 'pd-task-active ' : '') + (task.done ? 'pd-task-done' : '')}
              onClick={() => setActiveTaskId(task.id)}
            >
              <span>{task.title}</span>
              <small>{task.done ? 'Done' : task.id === activeTask?.id ? 'Active' : 'Queued'}</small>
              <em onClick={(event) => { event.stopPropagation(); toggleTask(task.id); }}>{task.done ? 'Restore' : 'Complete'}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="pd-history vai-card">
        <div className="pd-board-head">
          <div>
            <h2 className="pd-section-title">Session history</h2>
            <p className="pd-board-copy">Recent completed focus blocks stay visible for momentum.</p>
          </div>
          <span className="pd-streak">{openTasks.length} open</span>
        </div>
        {history.length > 0 ? (
          <ol className="pd-history-list">
            {history.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.taskTitle}</strong>
                <span>{entry.minutes} min · {entry.completedAt}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="pd-empty">
            <strong>No sessions logged yet.</strong>
            <span>Finish one focus block and the session history view will start filling in.</span>
          </div>
        )}
      </section>

      <section className="pd-settings">
        <h2 className="pd-section-title">Session lengths</h2>
        <div className="pd-grid">
          {(['work', 'short', 'long'] as const).map((p) => (
            <label key={p} className="pd-field">
              <span className="pd-field-label">{p === 'work' ? 'Focus' : p === 'short' ? 'Short break' : 'Long break'}</span>
              <div className="pd-field-row">
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={settings[p]}
                  onChange={(e) => setPhaseDuration(p, Number(e.target.value))}
                />
                <span className="pd-field-value">{settings[p]}<span className="pd-field-unit">min</span></span>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="pd-stats">
        <div className="pd-stats-row">
          <div>
            <div className="pd-stats-num">{completed}</div>
            <div className="pd-stats-label">Focus sessions completed</div>
          </div>
          <button type="button" className="pd-btn pd-btn-ghost" onClick={resetStats} disabled={completed === 0}>Reset</button>
        </div>
      </section>`;

const POMODORO_CSS = String.raw`.pd-timer { text-align: center; padding: 28px 24px; transition: border-color 240ms ease; }
.pd-phase-work { border-color: var(--vai-accent); }
.pd-phase-short { border-color: var(--vai-success); }
.pd-phase-long { border-color: var(--vai-accent-2); }
.pd-phase-row { display: flex; justify-content: space-between; align-items: center; color: var(--vai-muted); font-size: 13px; margin-bottom: 12px; }
.pd-phase-label { font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vai-text); font-size: 12px; }
.pd-cycle { font-variant-numeric: tabular-nums; }
.pd-time {
  font-size: clamp(72px, 18vw, 132px); font-weight: 700;
  font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: -0.04em;
  background: linear-gradient(135deg, var(--vai-text), var(--vai-accent));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  margin: 8px 0 18px;
}
.pd-progress { height: 6px; background: var(--vai-surface-2); border-radius: 999px; overflow: hidden; margin-bottom: 20px; }
.pd-progress-fill { height: 100%; background: linear-gradient(90deg, var(--vai-accent), var(--vai-accent-2)); transition: width 1s linear; }
.pd-controls { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.pd-btn {
  background: var(--vai-surface-2); color: var(--vai-text);
  border: 1px solid var(--vai-border-strong); border-radius: var(--vai-radius-sm);
  padding: 10px 22px; font-weight: 600; font-size: 14px; cursor: pointer;
  transition: all 140ms ease; min-width: 96px;
}
.pd-btn:hover:not(:disabled) { border-color: var(--vai-accent); color: var(--vai-accent); }
.pd-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pd-btn-primary {
  background: var(--vai-accent); color: white; border-color: var(--vai-accent);
}
.pd-btn-primary:hover:not(:disabled) { filter: brightness(1.15); color: white; }
.pd-btn-ghost { background: transparent; border-color: transparent; min-width: 0; padding: 6px 12px; font-size: 13px; color: var(--vai-muted); }
.pd-btn-ghost:hover:not(:disabled) { color: var(--vai-danger); border-color: transparent; }

.pd-task-board, .pd-history { padding: 20px; }
.pd-board-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
.pd-board-copy { margin: 4px 0 0; color: var(--vai-muted); font-size: 13px; line-height: 1.45; }
.pd-streak {
  flex: 0 0 auto; border: 1px solid var(--vai-border-strong); border-radius: 999px;
  padding: 6px 10px; color: var(--vai-accent); font-size: 12px; font-weight: 700;
}
.pd-task-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin-bottom: 14px; }
.pd-task-form input {
  min-width: 0; border: 1px solid var(--vai-border-strong); border-radius: var(--vai-radius-sm);
  background: var(--vai-surface-2); color: var(--vai-text); padding: 10px 12px; outline: none;
}
.pd-task-form input:focus { border-color: var(--vai-accent); }
.pd-task-list { display: grid; gap: 8px; }
.pd-task {
  width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center;
  border: 1px solid var(--vai-border); border-radius: var(--vai-radius-sm);
  background: var(--vai-surface-2); color: var(--vai-text); padding: 10px 12px; text-align: left;
}
.pd-task-active { border-color: var(--vai-accent); box-shadow: inset 3px 0 0 var(--vai-accent); }
.pd-task-done span { color: var(--vai-muted); text-decoration: line-through; }
.pd-task small { color: var(--vai-muted); font-size: 12px; }
.pd-task em { color: var(--vai-accent); font-style: normal; font-size: 12px; font-weight: 700; }
.pd-history-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.pd-history-list li, .pd-empty {
  border: 1px solid var(--vai-border); border-radius: var(--vai-radius-sm);
  background: var(--vai-surface-2); padding: 12px; display: grid; gap: 4px;
}
.pd-history-list span, .pd-empty span { color: var(--vai-muted); font-size: 12px; line-height: 1.45; }

.pd-section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vai-muted); margin: 0 0 14px; font-weight: 600; }
.pd-settings { padding: 20px 0 4px; border-top: 1px solid var(--vai-border); }
.pd-grid { display: grid; gap: 14px; }
.pd-field { display: block; }
.pd-field-label { display: block; font-size: 13px; color: var(--vai-muted); margin-bottom: 6px; }
.pd-field-row { display: flex; align-items: center; gap: 14px; }
.pd-field-row input[type=range] { flex: 1; accent-color: var(--vai-accent); }
.pd-field-value {
  font-variant-numeric: tabular-nums; font-weight: 600; color: var(--vai-text);
  min-width: 56px; text-align: right;
}
.pd-field-unit { color: var(--vai-muted); font-weight: 400; font-size: 12px; margin-left: 3px; }

.pd-stats { padding: 16px 0 4px; border-top: 1px solid var(--vai-border); }
.pd-stats-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.pd-stats-num { font-size: 32px; font-weight: 700; color: var(--vai-text); line-height: 1; }
.pd-stats-label { font-size: 12px; color: var(--vai-muted); margin-top: 4px; }

@media (max-width: 560px) {
  .pd-task-form, .pd-task { grid-template-columns: 1fr; }
  .pd-board-head { flex-direction: column; }
}
`;

export function generatePomodoroApp(brief: string): string {
  void brief;
  return composeAppShell({
    packageName: 'vai-pomodoro-app',
    title: 'Pomodoro · Vai',
    hero: {
      badge: 'Focus mode',
      title: 'Focus Planner.',
      accentWord: 'Focus',
      subtitle: 'A calm Pomodoro planner with tasks, streaks, session history, configurable focus blocks, and a gentle empty state for fresh starts.',
      pills: ['Pomodoro sessions', 'Tasks', 'Streaks', 'Session history'],
    },
    topMatter: POMODORO_TOP_MATTER,
    setupCode: POMODORO_SETUP,
    bodyJsx: POMODORO_BODY,
    extraCss: POMODORO_CSS,
    theme: { accent: '#ff6b5c', accent2: '#ffb05c' },
  });
}

export function pomodoroAppPlan(): string {
  return [
    '**Plan**',
    '',
    'Building a real Pomodoro timer:',
    '',
    '- Calm Focus Planner shell from Vai\'s shared design system',
    '- Task queue with active task selection',
    '- Streak and session history view with gentle empty state',
    '- Configurable focus / short break / long break durations',
    '- Auto-cycle with audio chime on phase end',
    '- Session counter persists across reloads',
    '',
  ].join('\n');
}
