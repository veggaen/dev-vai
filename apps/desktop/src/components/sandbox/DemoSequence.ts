/**
 * DemoSequence — Phase 0 scripted demonstration runner.
 *
 * Runs a choreographed sequence of Vai agent actions to showcase
 * the overlay system across the ENTIRE app — sidebar, chat,
 * templates, toolbar — not just the sandbox iframe.
 *
 * Supports both relative coordinates (0-1) and DOM element targeting
 * via CSS selectors for precise interaction with real UI elements.
 *
 * Consumed via `window.__vai_demo.run()` or the play button.
 */

export type DemoAction =
  | { type: 'move'; x: number; y: number; delay?: number }
  | { type: 'click'; x: number; y: number; delay?: number }
  | { type: 'hover'; x: number; y: number; delay?: number }
  | { type: 'focus'; x: number; y: number; label?: string; delay?: number }
  | { type: 'type'; x: number; y: number; text: string; delay?: number }
  | { type: 'screenshot'; delay?: number }
  | { type: 'radial'; x: number; y: number; selectId?: string; delay?: number }
  | { type: 'navigate'; url: string; delay?: number }
  | { type: 'scroll'; deltaY: number; delay?: number }
  | { type: 'assert'; kind: 'visible' | 'text'; selector: string; expected?: string; delay?: number }
  | { type: 'log'; message: string; detail?: string; delay?: number }
  | { type: 'wait'; ms: number }
  | { type: 'hide'; delay?: number }
  // Element-targeted actions — finds the REAL element and moves/clicks on it
  | { type: 'moveToEl'; selector: string; label?: string; delay?: number; offsetX?: number; offsetY?: number }
  | { type: 'clickEl'; selector: string; label?: string; delay?: number; realClick?: boolean }
  | { type: 'hoverEl'; selector: string; label?: string; delay?: number }
  | { type: 'typeInEl'; selector: string; text: string; label?: string; delay?: number; realFocus?: boolean }
  // Real typing — types character by character into the DOM input with keyboard sync
  | { type: 'realTypeInEl'; selector: string; text: string; label?: string; delay?: number; charDelay?: number }
  // Press Enter on an element (e.g., submit chat)
  | { type: 'pressEnter'; selector: string; label?: string; delay?: number }
  // Inject a fake assistant response into the chat (for demos without backend)
  | { type: 'injectResponse'; text: string; delay?: number; streamDelay?: number }
  // Wait for an element to appear in the DOM (polls every 500ms)
  | { type: 'waitForEl'; selector: string; timeout?: number; label?: string; delay?: number }
  // Click the first element containing specific text
  | { type: 'clickText'; text: string; tag?: string; label?: string; delay?: number }
  // Keyboard shortcut (e.g., Ctrl+K, Ctrl+Shift+C)
  | { type: 'keyCombo'; key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; label?: string; delay?: number };

/** Resolve a CSS selector to the center point of the element */
function elCenter(selector: string, offsetX = 0, offsetY = 0): { x: number; y: number } | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 + offsetX, y: r.top + r.height / 2 + offsetY };
}

/**
 * Default demo — showcases Vai navigating the FULL app.
 * Uses element selectors to target real UI buttons/inputs.
 */
export const DEFAULT_DEMO: DemoAction[] = [
  // ── Intro ──
  { type: 'log', message: 'Vai demo started — exploring the full app' },
  { type: 'wait', ms: 600 },

  // ── Start at center of screen ──
  { type: 'move', x: 0.5, y: 0.5, delay: 200 },
  { type: 'wait', ms: 400 },

  // ── Hover over Activity Rail icons ──
  { type: 'log', message: 'Scanning Activity Rail...' },
  { type: 'hoverEl', selector: '[title*="Chat History"]', label: 'Chat History', delay: 500 },
  { type: 'hoverEl', selector: '[title*="Dev Logs"]', label: 'Dev Logs', delay: 400 },
  { type: 'hoverEl', selector: '[title*="Knowledge"]', label: 'Knowledge Base', delay: 400 },
  { type: 'hoverEl', selector: '[title*="Search"]', label: 'Search', delay: 400 },
  { type: 'hoverEl', selector: '[title*="Settings"]', label: 'Settings', delay: 300 },

  // ── Click Chat History to open sidebar ──
  { type: 'clickEl', selector: '[title*="Chat History"]', label: 'Open Chats', delay: 600 },
  { type: 'wait', ms: 500 },

  // ── Click "New Chat" button ──
  { type: 'log', message: 'Starting a new chat...' },
  { type: 'clickEl', selector: 'button:has(.lucide-plus)', label: 'New Chat', delay: 600 },
  { type: 'wait', ms: 400 },

  // ── Move to the chat textarea and type ──
  { type: 'log', message: 'Composing a message...' },
  { type: 'moveToEl', selector: 'textarea', label: 'Chat input', delay: 400 },
  { type: 'realTypeInEl', selector: 'textarea', text: 'Hello Vai, build me a tier 1 pern app', label: 'Chat input', charDelay: 80 },
  { type: 'wait', ms: 1200 },

  // ── Take a screenshot ──
  { type: 'screenshot', delay: 400 },
  { type: 'log', message: 'Message composed — captured state' },
  { type: 'wait', ms: 600 },

  // ── Open radial menu in the center ──
  { type: 'log', message: 'Opening tool menu...' },
  { type: 'radial', x: 0.5, y: 0.5, selectId: 'deploy', delay: 800 },
  { type: 'wait', ms: 600 },

  // ── Move to builder panel toggle ──
  { type: 'log', message: 'Checking Builder panel...' },
  { type: 'hoverEl', selector: '[title*="preview"]', label: 'Toggle Preview', delay: 500 },
  { type: 'clickEl', selector: '[title*="preview"]', label: 'Show Preview', delay: 500 },
  { type: 'wait', ms: 500 },

  // ── Final screenshot ──
  { type: 'screenshot', delay: 400 },
  { type: 'log', message: 'Demo complete — all overlays exercised across the app ✓' },
  { type: 'wait', ms: 1500 },
  { type: 'hide' },
];

/**
 * Vai cursor API shape — matches window.__vai_cursor
 */
interface VaiCursorAPI {
  moveTo: (x: number, y: number) => void;
  click: (x: number, y: number) => void;
  hover: (x: number, y: number) => void;
  focus: (x: number, y: number, label?: string) => void;
  type: (x: number, y: number, text: string) => void;
  scroll: (deltaY: number) => void;
  navigateTo: (url: string) => void;
  screenshot: () => void;
  hide: () => void;
  openRadialMenu: (x: number, y: number) => void;
  closeRadialMenu: () => void;
  selectRadialItem: (id: string) => void;
  log: (type: string, message: string, detail?: string) => void;
  assertVisible: (selector: string) => void;
  assertText: (selector: string, expected: string) => void;
}

function getAPI(): VaiCursorAPI | null {
  return (window as unknown as Record<string, unknown>).__vai_cursor as VaiCursorAPI | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a sequence of demo actions against the Vai cursor API.
 *
 * @param actions - Array of demo actions to execute
 * @param containerWidth - Viewport or container width (for % → px conversion)
 * @param containerHeight - Viewport or container height
 * @param signal - AbortSignal to cancel the sequence
 */
export async function runDemoSequence(
  actions: DemoAction[],
  containerWidth: number,
  containerHeight: number,
  signal?: AbortSignal,
): Promise<void> {
  const api = getAPI();
  if (!api) {
    console.warn('[DemoSequence] No __vai_cursor API found');
    return;
  }

  for (const action of actions) {
    if (signal?.aborted) break;

    // Pre-delay
    if ('delay' in action && action.delay) {
      await sleep(action.delay);
    }
    if (signal?.aborted) break;

    // Convert relative coordinates (0-1) to px
    const px = (rel: number, dim: number) =>
      rel <= 1 ? Math.round(rel * dim) : rel;

    switch (action.type) {
      case 'move':
        api.moveTo(px(action.x, containerWidth), px(action.y, containerHeight));
        break;
      case 'click':
        api.click(px(action.x, containerWidth), px(action.y, containerHeight));
        break;
      case 'hover':
        api.hover(px(action.x, containerWidth), px(action.y, containerHeight));
        break;
      case 'focus':
        api.focus(px(action.x, containerWidth), px(action.y, containerHeight), action.label);
        break;
      case 'type':
        api.type(px(action.x, containerWidth), px(action.y, containerHeight), action.text);
        break;
      case 'screenshot':
        api.screenshot();
        break;
      case 'radial':
        api.openRadialMenu(px(action.x, containerWidth), px(action.y, containerHeight));
        if (action.selectId) {
          await sleep(600);
          if (signal?.aborted) break;
          api.selectRadialItem(action.selectId);
        }
        break;
      case 'navigate':
        api.navigateTo(action.url);
        break;
      case 'scroll':
        api.scroll(action.deltaY);
        break;
      case 'assert':
        if (action.kind === 'visible') api.assertVisible(action.selector);
        else if (action.kind === 'text') api.assertText(action.selector, action.expected || '');
        break;
      case 'log':
        api.log('info', action.message, action.detail);
        break;
      case 'wait':
        await sleep(action.ms);
        break;
      case 'hide':
        api.hide();
        break;

      // ── Element-targeted actions ──
      case 'moveToEl': {
        const pos = elCenter(action.selector, action.offsetX, action.offsetY);
        if (pos) {
          api.moveTo(pos.x, pos.y);
          if (action.label) api.log('info', `Moving to: ${action.label}`);
        } else {
          api.log('info', `Element not found: ${action.selector}`);
        }
        break;
      }
      case 'clickEl': {
        const pos = elCenter(action.selector);
        if (pos) {
          api.click(pos.x, pos.y);
          if (action.label) api.log('info', `Clicked: ${action.label}`);
          // Optionally trigger a real click on the DOM element
          if (action.realClick) {
            await sleep(200);
            const el = document.querySelector<HTMLElement>(action.selector);
            el?.click();
          }
        } else {
          api.log('info', `Element not found: ${action.selector}`);
        }
        break;
      }
      case 'hoverEl': {
        const pos = elCenter(action.selector);
        if (pos) {
          api.hover(pos.x, pos.y);
          if (action.label) api.log('info', `Hovering: ${action.label}`);
        } else {
          api.log('info', `Element not found: ${action.selector}`);
        }
        break;
      }
      case 'typeInEl': {
        const pos = elCenter(action.selector);
        if (pos) {
          // Optionally focus the real input for visual feedback
          if (action.realFocus) {
            const el = document.querySelector<HTMLElement>(action.selector);
            el?.focus();
          }
          api.type(pos.x, pos.y, action.text);
          if (action.label) api.log('info', `Typing in: ${action.label}`);
        } else {
          api.log('info', `Element not found: ${action.selector}`);
        }
        break;
      }

      // ── Real character-by-character typing with keyboard sync ──
      case 'realTypeInEl': {
        const pos = elCenter(action.selector);
        if (pos) {
          const el = document.querySelector<HTMLElement>(action.selector);
          if (el) {
            el.focus();
            api.moveTo(pos.x, pos.y);

            // Get the React-compatible value setter
            const isTextarea = el instanceof HTMLTextAreaElement;
            const isInput = el instanceof HTMLInputElement;
            const setter = isTextarea
              ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
              : isInput
                ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
                : null;

            // Show cursor as typing + show keyboard
            const store = getCursorStore();

            let currentText = '';
            const charMs = action.charDelay ?? 80;

            for (let i = 0; i < action.text.length; i++) {
              if (signal?.aborted) break;
              const ch = action.text[i];
              currentText += ch;

              // Update keyboard visual — highlight the current key
              if (store) {
                store.setState({
                  kbActiveKey: ch,
                  kbVisible: true,
                  cursor: { ...store.getState().cursor, x: pos.x, y: pos.y, visible: true, typing: true },
                });
              }

              // Type into the real input
              if (setter) {
                setter.call(el, currentText);
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }

              await sleep(charMs);
            }

            // Clear keyboard state
            if (store) {
              store.setState({
                kbActiveKey: null,
                kbVisible: false,
                cursor: { ...store.getState().cursor, typing: false },
              });
            }

            if (action.label) api.log('info', `Typed: ${action.label}`);
          } else {
            api.log('info', `Element not found: ${action.selector}`);
          }
        } else {
          api.log('info', `Element not found: ${action.selector}`);
        }
        break;
      }

      // ── Press Enter on element (for submitting forms/chat) ──
      case 'pressEnter': {
        const el = document.querySelector<HTMLElement>(action.selector);
        if (el) {
          el.focus();
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          if (action.label) api.log('info', `Enter: ${action.label}`);
        } else {
          api.log('info', `Element not found: ${action.selector}`);
        }
        break;
      }

      // ── Inject fake assistant response for demo purposes ──
      case 'injectResponse': {
        const chatStore = getChatStore();
        if (chatStore) {
          const state = chatStore.getState();
          const userMsg = {
            id: `demo-user-${Date.now()}`,
            role: 'user' as const,
            content: '',
          };
          // Use the last typed text as the user message
          const msgs = state.messages;
          const lastUserText = msgs.length > 0 && msgs[msgs.length - 1]?.role === 'user'
            ? msgs[msgs.length - 1].content
            : '';

          const assistantMsg = {
            id: `demo-assistant-${Date.now()}`,
            role: 'assistant' as const,
            content: '',
          };

          // Add empty assistant message for streaming effect
          if (lastUserText) {
            chatStore.setState({ messages: [...msgs, assistantMsg], isStreaming: true });
          } else {
            chatStore.setState({
              messages: [...msgs, { ...userMsg, content: 'Demo message' }, assistantMsg],
              isStreaming: true,
            });
          }

          // Stream the response character by character
          const streamMs = action.streamDelay ?? 20;
          let content = '';
          for (let i = 0; i < action.text.length; i++) {
            if (signal?.aborted) break;
            content += action.text[i];
            const currentMsgs = chatStore.getState().messages;
            const updated = [...currentMsgs];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content };
              chatStore.setState({ messages: updated });
            }
            await sleep(streamMs);
          }
          chatStore.setState({ isStreaming: false });
          api.log('info', 'Response streamed');
        }
        break;
      }

      // ── Wait for an element to appear in the DOM ──
      case 'waitForEl': {
        const timeout = action.timeout ?? 30000;
        const start = Date.now();
        if (action.label) api.log('info', `Waiting for: ${action.label}`);
        while (Date.now() - start < timeout) {
          if (signal?.aborted) break;
          if (document.querySelector(action.selector)) break;
          await sleep(500);
        }
        if (document.querySelector(action.selector)) {
          if (action.label) api.log('info', `Found: ${action.label}`);
        } else {
          api.log('info', `Timeout waiting for: ${action.selector}`);
        }
        break;
      }

      // ── Click the first element containing specific text ──
      case 'clickText': {
        const tag = action.tag || 'button';
        const els = document.querySelectorAll<HTMLElement>(tag);
        let clicked = false;
        for (const el of els) {
          if (el.textContent?.includes(action.text)) {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            api.click(cx, cy);
            await sleep(200);
            el.click();
            clicked = true;
            if (action.label) api.log('info', `Clicked: ${action.label}`);
            break;
          }
        }
        if (!clicked) {
          api.log('info', `Text not found: "${action.text}" in <${tag}>`);
        }
        break;
      }

      // ── Keyboard shortcut (dispatches a KeyboardEvent) ──
      case 'keyCombo': {
        // Derive correct `code` for common keys
        const key = action.key;
        let code: string;
        if (key.length === 1 && /[a-zA-Z]/.test(key)) code = `Key${key.toUpperCase()}`;
        else if (key.length === 1 && /[0-9]/.test(key)) code = `Digit${key}`;
        else code = key; // Escape, Enter, Space, ArrowUp, Tab, etc.

        const props: KeyboardEventInit = {
          key,
          code,
          ctrlKey: action.ctrl ?? false,
          shiftKey: action.shift ?? false,
          altKey: action.alt ?? false,
          bubbles: true,
          cancelable: true,
        };

        // Show the key on the virtual keyboard briefly
        const store = getCursorStore();
        if (store) {
          const display = (action.ctrl ? 'Ctrl+' : '') + (action.shift ? 'Shift+' : '') + (action.alt ? 'Alt+' : '') + key;
          store.setState({ kbActiveKey: display, kbVisible: true });
        }

        // Dispatch on both the focused element and document for maximum coverage
        const target = document.activeElement ?? document;
        target.dispatchEvent(new KeyboardEvent('keydown', props));
        if (target !== document) document.dispatchEvent(new KeyboardEvent('keydown', props));

        // Clear keyboard highlight after a short delay
        await sleep(300);
        if (store) store.setState({ kbActiveKey: null, kbVisible: false });

        if (action.label) api.log('info', `Key: ${action.label}`);
        break;
      }
    }
  }
}

/* ── Store accessors (lazy — avoid circular imports) ── */

interface CursorState {
  cursor: { x: number; y: number; visible: boolean; typing: boolean; clicking: boolean; hovering: boolean; label?: string };
  kbActiveKey: string | null;
  kbVisible: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
}

type CursorStoreAPI = { getState: () => CursorState; setState: (partial: Partial<CursorState>) => void };
type ChatStoreAPI = { getState: () => ChatState; setState: (partial: Partial<ChatState>) => void };

function getCursorStore(): CursorStoreAPI | null {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__vai_cursor_store) return w.__vai_cursor_store as CursorStoreAPI;
    return null;
  } catch { return null; }
}

function getChatStore(): ChatStoreAPI | null {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__vai_chat_store) return w.__vai_chat_store as ChatStoreAPI;
    return null;
  } catch { return null; }
}