/**
 * Odysseus-compatible theme engine (ported from odysseus/static/js/theme.js).
 *
 * Five core colors drive the entire UI:
 *   bg, fg, panel, border, red (accent)
 *
 * applyColors() writes them to :root, then derives syntax + advanced tokens
 * (sidebar, input, bubbles, send button, code blocks, brand mark).
 *
 * @see https://github.com/pewdiepie-archdaemon/odysseus
 */

export interface OdysseusCoreColors {
  bg: string;
  fg: string;
  panel: string;
  border: string;
  red: string;
  advanced?: Partial<OdysseusAdvancedColors>;
}

export interface OdysseusAdvancedColors {
  userBubbleBg: string;
  aiBubbleBg: string;
  bubbleBorder: string;
  sidebarBg: string;
  brandColor: string;
  hamburgerColor: string;
  inputBg: string;
  inputBorder: string;
  sendBtnBg: string;
  sendBtnHover: string;
  codeBg: string;
  codeFg: string;
  toggleActive: string;
}

export interface OdysseusThemePreset extends OdysseusCoreColors {
  id: string;
  label: string;
}

/** Built-in presets — same values as Odysseus theme.js THEMES */
export const ODYSSEUS_THEME_PRESETS: Record<string, OdysseusThemePreset> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    bg: '#282c34',
    fg: '#9cdef2',
    panel: '#111111',
    border: '#355a66',
    red: '#e06c75',
  },
  light: {
    id: 'light',
    label: 'Light',
    bg: '#f0ebe3',
    fg: '#5a5248',
    panel: '#faf6f0',
    border: '#d4cdc2',
    red: '#c47d5a',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    bg: '#0d1117',
    fg: '#c9d1d9',
    panel: '#161b22',
    border: '#30363d',
    red: '#f85149',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    bg: '#262624',
    fg: '#f5f4f0',
    panel: '#30302e',
    border: '#4a4a47',
    red: '#c6613f',
  },
  gpt: {
    id: 'gpt',
    label: 'GPT',
    bg: '#212121',
    fg: '#ececec',
    panel: '#171717',
    border: '#424242',
    red: '#949494',
    advanced: {
      sendBtnBg: '#949494',
      sendBtnHover: '#7f7f7f',
      userBubbleBg: '#2f2f2f',
      aiBubbleBg: '#171717',
      inputBg: '#2f2f2f',
    },
  },
};

export const VAI_THEME_STORAGE_KEY = 'vai-theme-preference';
export const VAI_CUSTOM_THEMES_KEY = 'vai-custom-themes';
export const VAI_ACTIVE_THEME_ID_KEY = 'vai-active-theme-id';

const ADV_KEYS: { key: keyof OdysseusAdvancedColors; css: string }[] = [
  { key: 'userBubbleBg', css: '--user-bubble-bg' },
  { key: 'aiBubbleBg', css: '--ai-bubble-bg' },
  { key: 'bubbleBorder', css: '--bubble-border' },
  { key: 'sidebarBg', css: '--sidebar-bg' },
  { key: 'brandColor', css: '--brand-color' },
  { key: 'hamburgerColor', css: '--hamburger-color' },
  { key: 'inputBg', css: '--input-bg' },
  { key: 'inputBorder', css: '--input-border' },
  { key: 'sendBtnBg', css: '--send-btn-bg' },
  { key: 'sendBtnHover', css: '--send-btn-hover' },
  { key: 'codeBg', css: '--code-bg' },
  { key: 'codeFg', css: '--code-fg' },
  { key: 'toggleActive', css: '--toggle-active' },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function hexToHSL(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function deriveSyntaxColors(colors: OdysseusCoreColors) {
  const [fgH, fgS, fgL] = hexToHSL(colors.fg);
  const [bgH, bgS, bgL] = hexToHSL(colors.bg);
  const [redH, redS] = hexToHSL(colors.red || '#e06c75');
  const isDark = bgL < 50;
  const codeBgL = isDark ? Math.max(bgL - 4, 0) : Math.min(bgL + 4, 100);
  return {
    bg: hslToHex(bgH, bgS, codeBgL),
    fg: colors.fg,
    keyword: hslToHex((redH + 280) % 360, Math.min(redS + 10, 80), isDark ? 70 : 45),
    string: hslToHex(40, Math.min(fgS + 20, 70), isDark ? 72 : 42),
    comment: hslToHex(fgH, Math.max(fgS - 20, 5), fgL * 0.5 + bgL * 0.5),
    function: hslToHex(210, Math.min(fgS + 20, 75), isDark ? 70 : 45),
    number: hslToHex(20, Math.min(fgS + 15, 65), isDark ? 68 : 48),
    builtin: hslToHex(180, Math.min(fgS + 15, 60), isDark ? 65 : 40),
    variable: hslToHex((fgH + 30) % 360, Math.min(fgS + 5, 60), isDark ? fgL : fgL),
    params: hslToHex(fgH, Math.max(fgS - 5, 10), isDark ? Math.min(fgL + 8, 85) : Math.max(fgL - 8, 25)),
  };
}

export function computeAdvancedDefaults(colors: OdysseusCoreColors): OdysseusAdvancedColors {
  const syn = deriveSyntaxColors(colors);
  const red = colors.red || '#e06c75';
  return {
    userBubbleBg: colors.bg,
    aiBubbleBg: colors.panel,
    bubbleBorder: colors.border,
    sidebarBg: colors.panel,
    brandColor: red,
    hamburgerColor: colors.fg,
    inputBg: colors.panel,
    inputBorder: colors.border,
    sendBtnBg: red,
    sendBtnHover: red,
    codeBg: syn.bg,
    codeFg: syn.fg,
    toggleActive: red,
  };
}

/** Apply Odysseus core + derived tokens to the document root. */
export function applyOdysseusColors(colors: OdysseusCoreColors): void {
  const root = document.documentElement.style;
  root.setProperty('--bg', colors.bg);
  root.setProperty('--fg', colors.fg);
  root.setProperty('--panel', colors.panel);
  root.setProperty('--border', colors.border);
  root.setProperty('--red', colors.red);
  root.setProperty('--accent', colors.red);

  const syn = deriveSyntaxColors(colors);
  root.setProperty('--hl-bg', syn.bg);
  root.setProperty('--hl-fg', syn.fg);
  root.setProperty('--hl-keyword', syn.keyword);
  root.setProperty('--hl-string', syn.string);
  root.setProperty('--hl-comment', syn.comment);
  root.setProperty('--hl-function', syn.function);
  root.setProperty('--hl-number', syn.number);
  root.setProperty('--hl-builtin', syn.builtin);
  root.setProperty('--hl-variable', syn.variable);
  root.setProperty('--hl-params', syn.params);

  const adv = { ...computeAdvancedDefaults(colors), ...colors.advanced };
  for (const { key, css } of ADV_KEYS) {
    root.setProperty(css, adv[key]);
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colors.bg);
}

export function applyOdysseusPreset(presetId: string): void {
  const custom = loadCustomThemes()[presetId];
  const preset = custom ?? ODYSSEUS_THEME_PRESETS[presetId] ?? ODYSSEUS_THEME_PRESETS.dark;
  applyOdysseusColors(preset);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(VAI_ACTIVE_THEME_ID_KEY, presetId);
  }
}

/** Maps Vai light/dark toggle → Odysseus presets (extensible to full theme picker). */
export function applyThemePreference(preference: 'dark' | 'light'): void {
  applyOdysseusPreset(preference);
  document.documentElement.dataset.theme = preference;
  document.body.dataset.theme = preference;
  document.documentElement.style.colorScheme = preference;
}

export function loadCustomThemes(): Record<string, OdysseusCoreColors> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(VAI_CUSTOM_THEMES_KEY) ?? '{}') as Record<string, OdysseusCoreColors>;
  } catch {
    return {};
  }
}

export function saveCustomTheme(name: string, colors: OdysseusCoreColors): void {
  const all = loadCustomThemes();
  all[name] = colors;
  localStorage.setItem(VAI_CUSTOM_THEMES_KEY, JSON.stringify(all));
}

/** Early boot — read storage before React paints (also called from index.html inline script). */
export function initOdysseusThemeFromStorage(): 'dark' | 'light' {
  const pref = (typeof localStorage !== 'undefined'
    ? localStorage.getItem(VAI_THEME_STORAGE_KEY)
    : null) as 'dark' | 'light' | null;
  const themeId = (typeof localStorage !== 'undefined'
    ? localStorage.getItem(VAI_ACTIVE_THEME_ID_KEY)
    : null) ?? pref ?? 'dark';
  const custom = loadCustomThemes()[themeId];
  if (custom) {
    applyOdysseusColors(custom);
  } else {
    applyOdysseusPreset(themeId in ODYSSEUS_THEME_PRESETS ? themeId : (pref ?? 'dark'));
  }
  const resolved = (pref ?? 'dark') as 'dark' | 'light';
  document.documentElement.dataset.theme = resolved;
  document.body.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}
