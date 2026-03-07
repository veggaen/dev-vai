/**
 * LiteKeyboard — Visual keyboard overlay for ALL key presses.
 *
 * Unlike VirtualKeyboard (typing-only QWERTY), this shows a compact
 * keyboard that lights up for ANY key press: shortcuts like Ctrl+O,
 * Tab, Escape, Enter, modifiers, function keys, etc.
 *
 * Layout (compact 60% style):
 *   Row 0: Esc  F1-F12
 *   Row 1: ` 1-9 0 - = ⌫
 *   Row 2: Tab  Q W E R T Y U I O P [ ] \
 *   Row 3: Caps A S D F G H J K L ; ' ↵
 *   Row 4: ⇧   Z X C V B N M , . / ⇧
 *   Row 5: Ctrl  Alt  ▬▬▬Space▬▬▬  Alt  Ctrl
 *
 * Active keys glow violet. Modifier keys (Ctrl, Alt, Shift, Meta)
 * stay highlighted while held. Combo display shows "Ctrl+O" text.
 *
 * Positioned bottom-center of viewport, always visible when active.
 */

import { AnimatePresence, motion } from 'framer-motion';

/* ── Key definitions ── */
interface KeyDef {
  id: string;          // Internal ID matching keyboard.press() key names
  label: string;       // Display label
  width?: number;      // Width multiplier (1 = standard key, 1.5 = 1.5x wide, etc.)
  isModifier?: boolean;
}

const ROW_FN: KeyDef[] = [
  { id: 'Escape', label: 'Esc', width: 1.3 },
  { id: 'F1', label: 'F1' }, { id: 'F2', label: 'F2' }, { id: 'F3', label: 'F3' },
  { id: 'F4', label: 'F4' }, { id: 'F5', label: 'F5' }, { id: 'F6', label: 'F6' },
  { id: 'F7', label: 'F7' }, { id: 'F8', label: 'F8' }, { id: 'F9', label: 'F9' },
  { id: 'F10', label: 'F10' }, { id: 'F11', label: 'F11' }, { id: 'F12', label: 'F12' },
];

const ROW_NUM: KeyDef[] = [
  { id: 'Backquote', label: '`' },
  { id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' },
  { id: '4', label: '4' }, { id: '5', label: '5' }, { id: '6', label: '6' },
  { id: '7', label: '7' }, { id: '8', label: '8' }, { id: '9', label: '9' },
  { id: '0', label: '0' }, { id: 'Minus', label: '-' }, { id: 'Equal', label: '=' },
  { id: 'Backspace', label: '⌫', width: 1.6 },
];

const ROW_TOP: KeyDef[] = [
  { id: 'Tab', label: 'Tab', width: 1.4 },
  { id: 'q', label: 'Q' }, { id: 'w', label: 'W' }, { id: 'e', label: 'E' },
  { id: 'r', label: 'R' }, { id: 't', label: 'T' }, { id: 'y', label: 'Y' },
  { id: 'u', label: 'U' }, { id: 'i', label: 'I' }, { id: 'o', label: 'O' },
  { id: 'p', label: 'P' }, { id: 'BracketLeft', label: '[' }, { id: 'BracketRight', label: ']' },
  { id: 'Backslash', label: '\\', width: 1.2 },
];

const ROW_HOME: KeyDef[] = [
  { id: 'CapsLock', label: 'Caps', width: 1.6 },
  { id: 'a', label: 'A' }, { id: 's', label: 'S' }, { id: 'd', label: 'D' },
  { id: 'f', label: 'F' }, { id: 'g', label: 'G' }, { id: 'h', label: 'H' },
  { id: 'j', label: 'J' }, { id: 'k', label: 'K' }, { id: 'l', label: 'L' },
  { id: 'Semicolon', label: ';' }, { id: 'Quote', label: "'" },
  { id: 'Enter', label: '↵', width: 1.8 },
];

const ROW_SHIFT: KeyDef[] = [
  { id: 'Shift', label: '⇧', width: 2.0, isModifier: true },
  { id: 'z', label: 'Z' }, { id: 'x', label: 'X' }, { id: 'c', label: 'C' },
  { id: 'v', label: 'V' }, { id: 'b', label: 'B' }, { id: 'n', label: 'N' },
  { id: 'm', label: 'M' }, { id: 'Comma', label: ',' }, { id: 'Period', label: '.' },
  { id: 'Slash', label: '/' },
  { id: 'ShiftRight', label: '⇧', width: 2.0, isModifier: true },
];

const ROW_BOTTOM: KeyDef[] = [
  { id: 'Control', label: 'Ctrl', width: 1.6, isModifier: true },
  { id: 'Meta', label: '⊞', width: 1.2, isModifier: true },
  { id: 'Alt', label: 'Alt', width: 1.2, isModifier: true },
  { id: ' ', label: '▬▬▬', width: 6.0 },
  { id: 'AltRight', label: 'Alt', width: 1.2, isModifier: true },
  { id: 'ControlRight', label: 'Ctrl', width: 1.6, isModifier: true },
];

// Arrow keys cluster (displayed inline after bottom row)
const ARROW_CLUSTER: KeyDef[] = [
  { id: 'ArrowLeft', label: '←' },
  { id: 'ArrowDown', label: '↓' },
  { id: 'ArrowUp', label: '↑' },
  { id: 'ArrowRight', label: '→' },
];

const ALL_ROWS = [ROW_FN, ROW_NUM, ROW_TOP, ROW_HOME, ROW_SHIFT, ROW_BOTTOM];

/* ── Normalize key names for matching ── */
function normalizeKey(key: string): string[] {
  const lower = key.toLowerCase();
  const aliases: string[] = [key, lower];

  // Map Puppeteer/browser key names to our key IDs
  switch (lower) {
    case 'control': aliases.push('controlleft', 'controlright'); break;
    case 'shift': aliases.push('shiftleft', 'shiftright'); break;
    case 'alt': aliases.push('altleft', 'altright'); break;
    case 'meta': aliases.push('metaleft', 'metaright'); break;
    case 'arrowup': case 'arrowdown': case 'arrowleft': case 'arrowright':
      aliases.push(lower); break;
    case 'enter': case 'return': aliases.push('enter', 'return'); break;
    case 'backspace': aliases.push('backspace', 'delete'); break;
    case 'escape': aliases.push('escape', 'esc'); break;
    case 'tab': aliases.push('tab'); break;
    case ' ': case 'space': aliases.push(' ', 'space'); break;
  }
  return aliases;
}

function isKeyActive(keyId: string, activeKeys: string[]): boolean {
  const lowerKeyId = keyId.toLowerCase();
  for (const active of activeKeys) {
    const aliases = normalizeKey(active);
    if (aliases.some(a => a.toLowerCase() === lowerKeyId)) return true;
    // Also match single character keys
    if (active.length === 1 && active.toLowerCase() === lowerKeyId) return true;
  }
  // Special: Shift matches ShiftRight and vice versa
  if (lowerKeyId === 'shift' || lowerKeyId === 'shiftright') {
    return activeKeys.some(a => a.toLowerCase() === 'shift' || a.toLowerCase() === 'shiftright' || a.toLowerCase() === 'shiftleft');
  }
  if (lowerKeyId === 'control' || lowerKeyId === 'controlright') {
    return activeKeys.some(a => a.toLowerCase() === 'control' || a.toLowerCase() === 'controlleft' || a.toLowerCase() === 'controlright');
  }
  if (lowerKeyId === 'alt' || lowerKeyId === 'altright') {
    return activeKeys.some(a => a.toLowerCase() === 'alt' || a.toLowerCase() === 'altleft' || a.toLowerCase() === 'altright');
  }
  return false;
}

/* ── Component Props ── */
interface LiteKeyboardProps {
  /** Array of currently active key IDs, e.g. ['Control', 'o'] */
  activeKeys: string[];
  /** Human-readable combo text, e.g. "Ctrl+O" */
  comboText: string | null;
  /** Whether the keyboard should be visible */
  visible: boolean;
}

export function LiteKeyboard({ activeKeys, comboText, visible }: LiteKeyboardProps) {
  // How long ago did keys become active? Used for auto-dismiss
  const hasActiveKeys = activeKeys.length > 0 || !!comboText;

  return (
    <AnimatePresence>
      {visible && hasActiveKeys && (
        <motion.div
          className="pointer-events-none fixed bottom-4 left-1/2 z-[64]"
          initial={{ opacity: 0, y: 20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 20, x: '-50%' }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {/* Combo text display */}
          {comboText && (
            <motion.div
              className="mb-2 mx-auto w-fit rounded-lg bg-violet-600/90 px-4 py-1.5 text-center text-sm font-bold text-white shadow-xl shadow-violet-500/30 backdrop-blur-md"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.1 }}
            >
              {comboText}
            </motion.div>
          )}

          {/* Keyboard */}
          <div className="rounded-2xl border border-zinc-700/40 bg-zinc-900/92 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
            {ALL_ROWS.map((row, ri) => (
              <div
                key={ri}
                className="flex justify-center gap-[2px] mb-[2px]"
              >
                {row.map((keyDef) => (
                  <LiteKey
                    key={keyDef.id}
                    keyDef={keyDef}
                    active={isKeyActive(keyDef.id, activeKeys)}
                    isModifier={keyDef.isModifier}
                  />
                ))}

                {/* Arrow cluster after bottom row */}
                {ri === 5 && (
                  <div className="flex gap-[2px] ml-2">
                    {ARROW_CLUSTER.map((keyDef) => (
                      <LiteKey
                        key={keyDef.id}
                        keyDef={keyDef}
                        active={isKeyActive(keyDef.id, activeKeys)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Label */}
            <div className="mt-1 text-center text-[7px] text-zinc-600 tracking-wider uppercase">
              Vai Keyboard
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Individual Key Component ── */
function LiteKey({
  keyDef, active, isModifier,
}: {
  keyDef: KeyDef;
  active: boolean;
  isModifier?: boolean;
}) {
  const baseWidth = 26; // px per unit
  const width = (keyDef.width ?? 1) * baseWidth;

  return (
    <motion.div
      className={`flex items-center justify-center rounded-md text-[8px] font-semibold select-none transition-colors ${
        active
          ? isModifier
            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/40'
            : 'bg-violet-500 text-white shadow-lg shadow-violet-500/40'
          : 'bg-zinc-800/50 text-zinc-600'
      }`}
      style={{
        width: `${width}px`,
        height: '24px',
        fontSize: keyDef.label.length > 3 ? '7px' : '9px',
      }}
      animate={active ? { scale: [1, 0.82, 1] } : { scale: 1 }}
      transition={{ duration: 0.12 }}
    >
      {keyDef.label}
    </motion.div>
  );
}
