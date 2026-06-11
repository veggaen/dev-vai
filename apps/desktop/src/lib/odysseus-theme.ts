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

/** Metadata stored alongside customized preset colors. */
export interface StoredCustomTheme extends OdysseusCoreColors {
  label: string;
  basePresetId: string;
}

export const CORE_COLOR_FIELDS: { key: keyof OdysseusCoreColors; label: string; hint: string }[] = [
  { key: 'bg', label: 'Background', hint: 'Page canvas and workspace' },
  { key: 'fg', label: 'Foreground', hint: 'Primary text and icons' },
  { key: 'panel', label: 'Panel', hint: 'Sidebar, inputs, AI bubbles' },
  { key: 'border', label: 'Border', hint: 'Lines and dividers' },
  { key: 'red', label: 'Accent', hint: 'Buttons, active states, brand' },
];

/** Strip preset metadata (id, label) — only the five core colors (+ optional advanced). */
export function pickOdysseusCoreColors(
  source: Partial<OdysseusCoreColors> & { id?: string; label?: string },
): OdysseusCoreColors {
  const fallback = ODYSSEUS_THEME_PRESETS.dark;
  const colors: OdysseusCoreColors = {
    bg: source.bg ?? fallback.bg,
    fg: source.fg ?? fallback.fg,
    panel: source.panel ?? fallback.panel,
    border: source.border ?? fallback.border,
    red: source.red ?? fallback.red,
  };
  if (source.advanced) colors.advanced = source.advanced;
  return colors;
}

function toStoredCustomTheme(
  storageId: string,
  theme: StoredCustomTheme & { id?: string },
): StoredCustomTheme {
  const basePresetId = theme.basePresetId || storageId.replace(/-custom$/, '');
  return {
    ...pickOdysseusCoreColors(theme),
    label: theme.label || customThemeLabelForBase(basePresetId),
    basePresetId,
  };
}

export function customThemeIdForBase(basePresetId: string): string {
  return `${basePresetId}-custom`;
}

export function customThemeLabelForBase(basePresetId: string): string {
  const preset = ODYSSEUS_THEME_PRESETS[basePresetId];
  return preset ? `${preset.label} Custom` : 'Custom';
}

export function resolveThemeColorScheme(themeId: string): 'dark' | 'light' {
  const base = themeId.replace(/-custom(?:-\d+)?$/, '');
  return base === 'light' ? 'light' : 'dark';
}

/** True when a saved custom variant of this base preset is the active theme. */
export function isCustomVariantActive(activeId: string, basePresetId: string): boolean {
  return activeId === customThemeIdForBase(basePresetId)
    || activeId.startsWith(`${basePresetId}-custom-`);
}

/** Base preset ring — only when that exact preset is active (not a custom fork). */
export function isBasePresetActive(activeId: string, basePresetId: string): boolean {
  return activeId === basePresetId && !isCustomVariantActive(activeId, basePresetId);
}

/** Custom theme card ring — exact id match only. */
export function isCustomThemeActive(activeId: string, customId: string): boolean {
  return activeId === customId;
}

/** Maps Vai light/dark header toggle → built-in dark/light presets only. */
export function applyThemePreference(preference: 'dark' | 'light'): void {
  applyThemeById(preference);
}

export function getThemeColorsById(themeId: string): OdysseusCoreColors {
  if (themeId in ODYSSEUS_THEME_PRESETS) {
    return ODYSSEUS_THEME_PRESETS[themeId];
  }
  const custom = loadCustomThemes()[themeId];
  if (custom) return custom;
  return ODYSSEUS_THEME_PRESETS.dark;
}

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
  applyThemeById(presetId);
}

function persistAppliedTheme(themeId: string, colors: OdysseusCoreColors): void {
  applyOdysseusColors(colors);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(VAI_ACTIVE_THEME_ID_KEY, themeId);
  }
  const scheme = resolveThemeColorScheme(themeId);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = scheme;
    document.body.dataset.theme = scheme;
    document.documentElement.style.colorScheme = scheme;
  }
}

/** Apply a built-in preset or saved custom theme by its unique id. */
export function applyThemeById(themeId: string): void {
  const builtins = ODYSSEUS_THEME_PRESETS;

  // Built-in ids always map to canonical presets — never a custom entry stored under the same key.
  if (themeId in builtins) {
    persistAppliedTheme(themeId, builtins[themeId]);
    return;
  }

  const custom = loadCustomThemes()[themeId];
  if (custom) {
    persistAppliedTheme(themeId, custom);
    return;
  }

  applyThemeById('dark');
}

export function getActiveThemeId(): string {
  if (typeof localStorage === 'undefined') return 'dark';
  return localStorage.getItem(VAI_ACTIVE_THEME_ID_KEY) ?? 'dark';
}

/** True only when this exact card id is the active theme — presets and customs are mutually exclusive. */
export function isThemeCardActive(activeId: string, cardId: string): boolean {
  return activeId === cardId;
}

const BUILTIN_THEME_IDS = new Set(Object.keys(ODYSSEUS_THEME_PRESETS));

/** Migrate legacy custom themes saved under preset ids (e.g. "dark") → "dark-custom". */
function normalizeCustomThemes(
  raw: Record<string, StoredCustomTheme>,
): { themes: Record<string, StoredCustomTheme>; migrated: boolean } {
  const out: Record<string, StoredCustomTheme> = {};
  let migrated = false;

  for (const [key, theme] of Object.entries(raw)) {
    const cleaned = toStoredCustomTheme(key, theme);
    if (BUILTIN_THEME_IDS.has(key)) {
      const newKey = customThemeIdForBase(key);
      if (!out[newKey]) {
        out[newKey] = toStoredCustomTheme(newKey, {
          ...cleaned,
          basePresetId: cleaned.basePresetId || key,
        });
      }
      migrated = true;
    } else {
      const prev = out[key];
      if (!prev || JSON.stringify(prev) !== JSON.stringify(cleaned)) {
        migrated = true;
      }
      out[key] = cleaned;
    }
  }

  return { themes: out, migrated };
}

export function loadCustomThemes(): Record<string, StoredCustomTheme> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(VAI_CUSTOM_THEMES_KEY) ?? '{}') as Record<string, StoredCustomTheme>;
    const { themes, migrated } = normalizeCustomThemes(raw);
    if (migrated) {
      localStorage.setItem(VAI_CUSTOM_THEMES_KEY, JSON.stringify(themes));
      const active = localStorage.getItem(VAI_ACTIVE_THEME_ID_KEY);
      if (active && BUILTIN_THEME_IDS.has(active) && raw[active]) {
        localStorage.setItem(VAI_ACTIVE_THEME_ID_KEY, customThemeIdForBase(active));
      }
    }
    return themes;
  } catch {
    return {};
  }
}

export function listCustomThemeEntries(): (StoredCustomTheme & { id: string })[] {
  return Object.entries(loadCustomThemes()).map(([storageId, theme]) => ({
    ...theme,
    id: storageId,
  }));
}

export function saveCustomThemeFromPreset(
  basePresetId: string,
  colors: OdysseusCoreColors,
): string {
  const id = customThemeIdForBase(basePresetId);
  const entry: StoredCustomTheme = {
    ...pickOdysseusCoreColors(colors),
    label: customThemeLabelForBase(basePresetId),
    basePresetId,
  };
  saveCustomTheme(id, entry);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(VAI_ACTIVE_THEME_ID_KEY, id);
  }
  applyOdysseusColors(entry);
  return id;
}

export function saveCustomTheme(name: string, colors: StoredCustomTheme | OdysseusCoreColors): void {
  const all = loadCustomThemes();
  const basePresetId = 'basePresetId' in colors && colors.basePresetId
    ? colors.basePresetId
    : name.replace(/-custom$/, '');
  const entry: StoredCustomTheme = {
    ...pickOdysseusCoreColors(colors),
    label: 'label' in colors && colors.label ? colors.label : customThemeLabelForBase(basePresetId),
    basePresetId,
  };
  all[name] = entry;
  localStorage.setItem(VAI_CUSTOM_THEMES_KEY, JSON.stringify(all));
}

/** Early boot — read storage before React paints (also called from index.html inline script). */
export function initOdysseusThemeFromStorage(): 'dark' | 'light' {
  loadCustomThemes();
  const themeId = getActiveThemeId();
  applyThemeById(themeId);
  return resolveThemeColorScheme(themeId);
}
