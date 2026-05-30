import { composeAppShell } from '../app-shell/index.js';

const PW_TOP_MATTER = String.raw`
interface PwSettings {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
}

const SETTINGS_KEY = 'vai.password.settings.v1';
const HISTORY_KEY = 'vai.password.history.v1';

const DEFAULT_SETTINGS: PwSettings = { length: 16, upper: true, lower: true, digits: true, symbols: true };

const POOL = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/',
};

function loadSettings(): PwSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<PwSettings>;
    return {
      length: typeof p.length === 'number' ? Math.max(6, Math.min(64, p.length)) : DEFAULT_SETTINGS.length,
      upper: typeof p.upper === 'boolean' ? p.upper : DEFAULT_SETTINGS.upper,
      lower: typeof p.lower === 'boolean' ? p.lower : DEFAULT_SETTINGS.lower,
      digits: typeof p.digits === 'boolean' ? p.digits : DEFAULT_SETTINGS.digits,
      symbols: typeof p.symbols === 'boolean' ? p.symbols : DEFAULT_SETTINGS.symbols,
    };
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettings(s: PwSettings) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').slice(0, 5);
  } catch { return []; }
}

function saveHistory(items: string[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch {}
}

function randomInt(max: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function generatePassword(s: PwSettings): string {
  const pools: string[] = [];
  if (s.upper) pools.push(POOL.upper);
  if (s.lower) pools.push(POOL.lower);
  if (s.digits) pools.push(POOL.digits);
  if (s.symbols) pools.push(POOL.symbols);
  if (pools.length === 0) return '';
  const all = pools.join('');
  const result: string[] = [];
  for (const pool of pools) {
    result.push(pool[randomInt(pool.length)]);
  }
  while (result.length < s.length) {
    result.push(all[randomInt(all.length)]);
  }
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join('');
}

interface Strength {
  score: number;
  label: string;
  color: string;
}

function scorePassword(pw: string): Strength {
  if (!pw) return { score: 0, label: 'Empty', color: 'var(--vai-muted)' };
  let score = 0;
  const len = pw.length;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  if (len >= 24) score += 1;
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/[0-9]/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  score += variety - 1;
  score = Math.max(0, Math.min(6, score));
  if (score <= 1) return { score, label: 'Weak', color: 'var(--vai-danger)' };
  if (score <= 3) return { score, label: 'Okay', color: '#ffb05c' };
  if (score <= 4) return { score, label: 'Strong', color: '#5ce1ff' };
  return { score, label: 'Excellent', color: 'var(--vai-success)' };
}
`;

const PW_SETUP = String.raw`  const [settings, setSettings] = useState<PwSettings>(() => loadSettings());
  const [password, setPassword] = useState<string>('');
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveHistory(history); }, [history]);

  useEffect(() => {
    setPassword(generatePassword(settings));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strength = useMemo(() => scorePassword(password), [password]);

  function regenerate() {
    const next = generatePassword(settings);
    setPassword(next);
    if (next) {
      setHistory((h) => [next, ...h.filter((x) => x !== next)].slice(0, 5));
    }
  }

  async function copy(text: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        window.setTimeout(() => setCopied((c) => c === text ? null : c), 1200);
      }
    } catch {}
  }

  function toggle(key: 'upper' | 'lower' | 'digits' | 'symbols') {
    setSettings((s) => {
      const next = { ...s, [key]: !s[key] };
      const anyOn = next.upper || next.lower || next.digits || next.symbols;
      if (!anyOn) return s;
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
  }
`;

const PW_BODY = String.raw`      <section className="pw-display vai-card">
        <div className="pw-output" aria-label="Generated password">
          <span className="pw-value">{password || '—'}</span>
        </div>
        <div className="pw-actions">
          <button type="button" className="pw-btn" onClick={regenerate}>Regenerate</button>
          <button type="button" className="pw-btn pw-btn-secondary" onClick={() => copy(password)} disabled={!password}>
            {copied === password && password ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="pw-strength">
          <div className="pw-strength-bar">
            <div
              className="pw-strength-fill"
              style={{ width: (strength.score / 6 * 100).toFixed(0) + '%', background: strength.color }}
            />
          </div>
          <span className="pw-strength-label" style={{ color: strength.color }}>{strength.label}</span>
        </div>
      </section>

      <section className="pw-settings">
        <label className="pw-field">
          <div className="pw-field-head">
            <span className="pw-field-label">Length</span>
            <span className="pw-field-value">{settings.length}</span>
          </div>
          <input
            type="range"
            min={6}
            max={64}
            value={settings.length}
            onChange={(e) => setSettings((s) => ({ ...s, length: Number(e.target.value) }))}
          />
        </label>

        <div className="pw-toggles">
          {([
            ['upper', 'Uppercase A-Z'],
            ['lower', 'Lowercase a-z'],
            ['digits', 'Digits 0-9'],
            ['symbols', 'Symbols !@#$'],
          ] as const).map(([key, label]) => (
            <label key={key} className={settings[key] ? 'pw-toggle is-on' : 'pw-toggle'}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={() => toggle(key)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      {history.length > 0 && (
        <section className="pw-history">
          <div className="pw-history-head">
            <h2 className="pw-section-title">Recent</h2>
            <button type="button" className="pw-link" onClick={clearHistory}>Clear</button>
          </div>
          <ul className="pw-history-list">
            {history.map((h) => (
              <li key={h} className="pw-history-item">
                <span className="pw-history-value">{h}</span>
                <button type="button" className="pw-history-copy" onClick={() => copy(h)}>
                  {copied === h ? '✓' : 'Copy'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}`;

const PW_CSS = String.raw`.pw-display { padding: 22px 20px; }
.pw-output {
  background: var(--vai-bg); border: 1px solid var(--vai-border);
  border-radius: var(--vai-radius-sm); padding: 16px 18px;
  font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 18px;
  color: var(--vai-text); word-break: break-all; line-height: 1.4;
  min-height: 56px; display: flex; align-items: center;
}
.pw-value { user-select: all; }
.pw-actions { display: flex; gap: 8px; margin-top: 12px; }
.pw-btn {
  flex: 1; background: var(--vai-accent); color: white; border: none;
  border-radius: var(--vai-radius-sm); padding: 11px 16px;
  font-weight: 600; font-size: 14px; cursor: pointer;
  transition: filter 140ms ease, transform 140ms ease;
}
.pw-btn:hover:not(:disabled) { filter: brightness(1.15); }
.pw-btn:active:not(:disabled) { transform: scale(0.98); }
.pw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pw-btn-secondary {
  background: var(--vai-surface-2); color: var(--vai-text);
  border: 1px solid var(--vai-border-strong);
}
.pw-btn-secondary:hover:not(:disabled) { border-color: var(--vai-accent); color: var(--vai-accent); }

.pw-strength { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.pw-strength-bar { flex: 1; height: 6px; background: var(--vai-surface-2); border-radius: 999px; overflow: hidden; }
.pw-strength-fill { height: 100%; transition: width 220ms ease, background 220ms ease; border-radius: inherit; }
.pw-strength-label { font-size: 13px; font-weight: 600; min-width: 80px; text-align: right; }

.pw-settings { padding: 20px 0 4px; display: grid; gap: 18px; border-top: 1px solid var(--vai-border); }
.pw-field-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.pw-field-label { font-size: 13px; color: var(--vai-muted); }
.pw-field-value { font-size: 16px; font-weight: 700; color: var(--vai-text); font-variant-numeric: tabular-nums; }
.pw-field input[type=range] { width: 100%; accent-color: var(--vai-accent); }

.pw-toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pw-toggle {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--vai-radius-sm);
  border: 1px solid var(--vai-border); background: var(--vai-surface-2);
  cursor: pointer; font-size: 14px; color: var(--vai-muted);
  transition: all 140ms ease; user-select: none;
}
.pw-toggle:hover { border-color: var(--vai-border-strong); color: var(--vai-text); }
.pw-toggle.is-on { border-color: var(--vai-accent); color: var(--vai-text); background: var(--vai-surface); }
.pw-toggle input { accent-color: var(--vai-accent); width: 16px; height: 16px; }

.pw-history { padding: 18px 0 4px; border-top: 1px solid var(--vai-border); }
.pw-history-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.pw-section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vai-muted); margin: 0; font-weight: 600; }
.pw-link { background: none; border: none; color: var(--vai-muted); font-size: 12px; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
.pw-link:hover { color: var(--vai-danger); }
.pw-history-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.pw-history-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--vai-bg); border-radius: var(--vai-radius-sm);
  border: 1px solid var(--vai-border);
}
.pw-history-value {
  flex: 1; font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px; color: var(--vai-text); word-break: break-all;
}
.pw-history-copy {
  background: transparent; border: 1px solid var(--vai-border-strong);
  color: var(--vai-muted); padding: 6px 10px; border-radius: 6px;
  font-size: 12px; cursor: pointer; transition: all 140ms ease;
  min-width: 56px;
}
.pw-history-copy:hover { border-color: var(--vai-accent); color: var(--vai-accent); }

@media (max-width: 480px) {
  .pw-toggles { grid-template-columns: 1fr; }
  .pw-actions { flex-direction: column; }
}
`;

export function generatePasswordApp(brief: string): string {
  void brief;
  return composeAppShell({
    packageName: 'vai-password-app',
    title: 'Password · Vai',
    hero: {
      badge: 'Stay secure',
      title: 'Generate strong passwords.',
      accentWord: 'strong',
      subtitle: 'Customizable length, character-type toggles, live strength meter, one-click copy. Your last five generations stay handy.',
      pills: ['6–64 chars', 'Char-type toggles', 'Strength meter', 'One-click copy'],
    },
    topMatter: PW_TOP_MATTER,
    setupCode: PW_SETUP,
    bodyJsx: PW_BODY,
    extraCss: PW_CSS,
    theme: { accent: '#4ade80', accent2: '#5ce1ff' },
  });
}

export function passwordAppPlan(): string {
  return [
    '**Plan**',
    '',
    'Building a real password generator:',
    '',
    '- Polished landing hero from Vai\'s shared design system',
    '- Length slider (6–64) + uppercase/lowercase/digits/symbols toggles',
    '- Strength meter (length + variety) with color-graded bar',
    '- Crypto-strong RNG, recent-5 history, copy with feedback',
    '',
  ].join('\n');
}
