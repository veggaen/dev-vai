/**
 * VaiQARunner — Visual QA automation using the simulated cursor system.
 *
 * Drives the app through a full builder flow using window.__vai_cursor:
 * 1. Navigate to builder mode
 * 2. Type a prompt in the chat textarea
 * 3. Send and watch the response stream
 * 4. Click "Code" to verify file hierarchy
 * 5. Click "Preview" to verify the live app
 * 6. Verify status pills and UI state
 *
 * Triggered via: window.__vai_qa.run() or /api/vai/qa-run
 */

import { useCursorStore } from '../stores/cursorStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useChatStore } from '../stores/chatStore.js';

const API_BASE = 'http://localhost:3006';

/** Attach to a running sandbox — always picks the RUNNING one, even if store already has a stale project */
async function ensureSandboxAttached(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/sandbox`);
    const projects = await res.json() as { id: string; status: string; devPort: number | null }[];
    const running = projects.find(p => p.status === 'running' && p.devPort);

    if (running) {
      const store = useSandboxStore.getState();
      // Re-attach if the current project doesn't match or has no port
      if (store.projectId !== running.id || !store.devPort) {
        await useSandboxStore.getState().attachProject(running.id);
      }
      return true;
    }
  } catch { /* no sandbox available */ }
  return false;
}

/** Load the conversation linked to the currently attached sandbox */
async function ensureConversationLoaded(): Promise<boolean> {
  const sandboxId = useSandboxStore.getState().projectId;
  if (!sandboxId) return false;

  try {
    const res = await fetch(`${API_BASE}/api/conversations?limit=20`);
    const convs = await res.json() as { id: string; mode: string; sandboxProjectId?: string }[];
    // Find the conversation linked to the current sandbox
    const linked = convs.find(c => c.sandboxProjectId === sandboxId);
    if (linked) {
      const chat = useChatStore.getState();
      if (chat.activeConversationId !== linked.id) {
        await chat.selectConversation(linked.id);
      }
      return true;
    }
  } catch { /* no conversation available */ }
  return false;
}

/* ── Helpers ───────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function cursor() {
  return useCursorStore.getState();
}

/** Find an element by selector, return its center coordinates */
function elCenter(selector: string): { x: number; y: number; el: HTMLElement } | null {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, el };
}

/** Find element by text content (searches buttons, spans, divs) */
function elByText(text: string, tag = '*'): { x: number; y: number; el: HTMLElement } | null {
  const els = document.querySelectorAll(tag);
  for (const el of els) {
    if ((el as HTMLElement).textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, el: el as HTMLElement };
      }
    }
  }
  return null;
}

/** Visually type into a textarea char by char */
async function visualType(
  textarea: HTMLTextAreaElement,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const c = cursor();
  const rect = textarea.getBoundingClientRect();
  c.moveTo(rect.left + 20, rect.top + 20);
  await sleep(300);
  c.click(rect.left + 20, rect.top + 20);
  textarea.focus();
  await sleep(200);

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const charDelay = Math.max(12, Math.min(40, 6000 / text.length));

  useCursorStore.setState({ cursor: { ...c.cursor, typing: true } });

  // Show lite keyboard once at start — only update the displayed key, never hide/show
  useCursorStore.setState({ liteKbVisible: true, liteKbActiveKeys: ['typing'], liteKbComboText: 'Typing...' });

  for (let i = 0; i < text.length; i++) {
    if (signal?.aborted) break;
    const partial = text.slice(0, i + 1);
    if (setter) {
      setter.call(textarea, partial);
    } else {
      textarea.value = partial;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Update displayed key without toggling visibility
    if (i % 3 === 0) {
      const ch = text[i] === ' ' ? '␣' : text[i];
      useCursorStore.setState({ liteKbActiveKeys: [ch], liteKbComboText: ch });
    }
    await sleep(charDelay);
  }

  // Done typing — hide keyboard and reset cursor state
  useCursorStore.setState({
    cursor: { ...useCursorStore.getState().cursor, typing: false },
    liteKbVisible: false,
    liteKbActiveKeys: [],
    liteKbComboText: null,
  });
}

/* ── QA Steps ──────────────────────────────────────────────── */

interface QAResult {
  passed: boolean;
  steps: { name: string; passed: boolean; detail: string }[];
}

export async function runVisualQA(
  signal?: AbortSignal,
  options?: {
    prompt?: string;
    skipSend?: boolean;  // If true, don't actually send — just verify UI
  },
): Promise<QAResult> {
  const c = cursor();
  const result: QAResult = { passed: true, steps: [] };

  function step(name: string, passed: boolean, detail: string) {
    result.steps.push({ name, passed, detail });
    if (!passed) result.passed = false;
    c.log(passed ? 'info' : 'info', `${passed ? '✓' : '✗'} ${name}`, detail);
  }

  // ═══ Setup ═══
  c.setOverlayVisible(true);
  c.setRecording(true);
  c.setLabel('QA Agent');
  c.log('info', '🔍 Visual QA: Starting builder flow test', 'Simulated cursor will drive the UI');
  c.moveTo(window.innerWidth / 2, window.innerHeight / 2);
  await sleep(600);

  // Auto-attach sandbox and conversation
  await ensureSandboxAttached();
  await ensureConversationLoaded();
  useLayoutStore.getState().setMode('builder');
  await sleep(500);
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 1: Switch to Builder mode (Ctrl+3) ═══
  c.log('info', '📋 Step 1: Switching to Builder mode');

  // Try clicking the mode selector first
  const modeBtn = elByText('builder', 'button') ?? elCenter('[data-mode="builder"]');
  if (modeBtn) {
    c.moveTo(modeBtn.x, modeBtn.y);
    await sleep(400);
    c.click(modeBtn.x, modeBtn.y);
    modeBtn.el.click();
    await sleep(600);
    step('Switch to Builder', true, 'Clicked builder mode button');
  } else {
    // Fallback: use keyboard shortcut
    c.pressKeys(['Ctrl', '3'], 'Ctrl+3');
    await sleep(300);
    c.releaseKeys();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }));
    await sleep(600);
    step('Switch to Builder', true, 'Used Ctrl+3 keyboard shortcut');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 2: Verify chat textarea is present ═══
  c.log('info', '📋 Step 2: Finding chat input');
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
  if (textarea) {
    const rect = textarea.getBoundingClientRect();
    c.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await sleep(500);
    step('Chat textarea found', true, `At (${Math.round(rect.left)}, ${Math.round(rect.top)})`);
  } else {
    step('Chat textarea found', false, 'No textarea element in DOM');
    return cleanup(result);
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 3: Type the prompt ═══
  const prompt = options?.prompt ?? 'Build me a polished fitness dashboard with workout tracker, meal planner, and Google auth';
  c.log('info', `📋 Step 3: Typing prompt`);
  await visualType(textarea, prompt, signal);
  await sleep(300);
  c.screenshot();
  step('Typed prompt', true, `"${prompt.slice(0, 50)}..." (${prompt.length} chars)`);
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 4: Send the message ═══
  if (!options?.skipSend) {
    c.log('info', '📋 Step 4: Sending message');

    // Find send button
    const sendBtn = elCenter('button[type="submit"]')
      ?? elCenter('[data-testid="send-button"]')
      ?? elByText('send', 'button');

    if (sendBtn) {
      c.moveTo(sendBtn.x, sendBtn.y);
      await sleep(300);
      c.click(sendBtn.x, sendBtn.y);
      sendBtn.el.click();
      step('Clicked send', true, 'Send button clicked');
    } else {
      // Fallback: press Enter
      c.pressKeys(['Enter'], 'Enter');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(200);
      c.releaseKeys();
      step('Clicked send', true, 'Pressed Enter (no send button found)');
    }
    await sleep(1000);

    // ═══ Step 5: Watch for streaming response ═══
    c.log('info', '📋 Step 5: Watching for Vai response...');
    let responseFound = false;

    for (let i = 0; i < 30; i++) {
      if (signal?.aborted) break;
      await sleep(2000);
      const elapsed = (i + 1) * 2;

      // Check for assistant message in the DOM
      const messages = document.querySelectorAll('[data-role="assistant"]');
      const streamingEl = document.querySelector('[data-streaming="true"]');

      if (messages.length > 0 || streamingEl) {
        if (streamingEl) {
          c.log('info', `⏳ Streaming... (${elapsed}s)`);
          // Move cursor near the streaming message
          const rect = streamingEl.getBoundingClientRect();
          c.moveTo(rect.left + 100, rect.top + rect.height / 2);
        }

        // Check if streaming is complete
        if (messages.length > 0 && !streamingEl) {
          responseFound = true;
          c.screenshot();
          step('Response received', true, `Got ${messages.length} assistant message(s) after ${elapsed}s`);
          break;
        }
      }

      // Also check via API
      if (i > 5 && i % 3 === 0) {
        try {
          const res = await fetch(`${API_BASE}/api/conversations?limit=1`);
          const convs = await res.json() as { id: string; mode: string }[];
          if (convs.length > 0 && convs[0].mode === 'builder') {
            const msgsRes = await fetch(`${API_BASE}/api/conversations/${convs[0].id}/messages`);
            const msgs = await msgsRes.json() as { role: string; content: string }[];
            const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
            if (lastAssistant && lastAssistant.content.length > 100) {
              responseFound = true;
              step('Response received', true, `API confirmed: ${lastAssistant.content.length} chars`);
              break;
            }
          }
        } catch { /* still waiting */ }
      }

      // Screenshot every 10s
      if (elapsed % 10 === 0) c.screenshot();
    }

    if (!responseFound) {
      step('Response received', false, 'No response after 60s');
    }
  } else {
    step('Skipped send', true, 'skipSend=true — verifying UI only');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 6: Verify Preview Panel is visible ═══
  c.log('info', '📋 Step 6: Checking preview panel');
  await sleep(1500);

  const previewPanel = elCenter('[data-testid="preview-panel"]')
    ?? document.querySelector('.preview-panel, [class*="preview"]') as HTMLElement | null;

  if (previewPanel) {
    step('Preview panel visible', true, 'Builder preview panel is rendered');
  } else {
    step('Preview panel visible', false, 'Preview panel not found in DOM');
  }

  // ═══ Step 7: Click "Code" tab to verify file hierarchy ═══
  c.log('info', '📋 Step 7: Testing Code view');
  const codeBtn = elByText('code', 'button');
  if (codeBtn) {
    c.moveTo(codeBtn.x, codeBtn.y);
    await sleep(400);
    c.click(codeBtn.x, codeBtn.y);
    codeBtn.el.click();
    await sleep(1500);

    // Check if file list appeared
    const fileItems = document.querySelectorAll('[data-testid="file-tab"], [class*="file-tab"], [class*="FileTab"]');
    const codeEditor = document.querySelector('[data-testid="code-editor"], [class*="code-editor"], pre, .cm-editor, textarea[readonly]');

    if (fileItems.length > 0 || codeEditor) {
      c.screenshot();
      step('Code view shows files', true, `${fileItems.length} file tabs visible, editor present: ${!!codeEditor}`);
    } else {
      // Check if any file-related text is visible
      const hasFileText = elByText('.tsx', 'button') ?? elByText('.ts', 'button') ?? elByText('package.json', 'button');
      if (hasFileText) {
        c.screenshot();
        step('Code view shows files', true, 'File names visible in Code view');
      } else {
        c.screenshot();
        step('Code view shows files', false, 'No file tabs or code editor found after clicking Code');
      }
    }
  } else {
    step('Code view shows files', false, 'Could not find Code button');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 8: Click "Preview" tab to verify iframe ═══
  c.log('info', '📋 Step 8: Testing Preview view');
  const previewBtn = elByText('preview', 'button');
  if (previewBtn) {
    c.moveTo(previewBtn.x, previewBtn.y);
    await sleep(400);
    c.click(previewBtn.x, previewBtn.y);
    previewBtn.el.click();
    await sleep(1500);

    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.src) {
      c.screenshot();
      step('Preview iframe loaded', true, `iframe src: ${iframe.src}`);
    } else {
      step('Preview iframe loaded', false, 'No iframe found in Preview tab');
    }
  } else {
    step('Preview iframe loaded', false, 'Could not find Preview button');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Step 9: Verify status pills ═══
  c.log('info', '📋 Step 9: Checking status pills');
  const _statusArea = document.querySelector('[class*="status"], [data-testid="status-pills"]');
  const pills = document.querySelectorAll('[class*="pill"], [class*="badge"], [class*="status-item"]');

  // Check no "Preview code mode is ready" text
  const badPill = elByText('Preview code mode is ready');
  if (badPill) {
    step('Status pill text clean', false, 'Still showing old "Preview code mode is ready" text');
  } else {
    step('Status pill text clean', true, `${pills.length} status indicators found, no stale text`);
  }

  // ═══ Summary ═══
  c.log('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const passed = result.steps.filter(s => s.passed).length;
  const total = result.steps.length;
  c.log('info', `🔍 QA Complete: ${passed}/${total} checks passed`, result.passed ? 'ALL PASSED' : 'SOME FAILED');

  for (const s of result.steps) {
    c.log('info', `  ${s.passed ? '✓' : '✗'} ${s.name}`, s.detail);
  }

  c.screenshot();

  return cleanup(result);
}

function cleanup(result: QAResult): QAResult {
  const c = cursor();
  c.setRecording(false);
  c.setLabel('');
  // Keep overlay visible so user can see the results
  return result;
}

/* ── Full Build + Iterate + Deploy flow ──────────────────── */

/**
 * Full visual build flow:
 * 1. Build a new app via chat
 * 2. Wait for sandbox to spin up
 * 3. Switch between Code/Preview tabs
 * 4. Send an iteration prompt
 * 5. Verify the iteration
 * 6. Open the live preview
 */
export async function runFullBuildFlow(
  signal?: AbortSignal,
  options?: {
    buildPrompt?: string;
    iteratePrompt?: string;
  },
): Promise<QAResult> {
  const c = cursor();
  const result: QAResult = { passed: true, steps: [] };

  function step(name: string, passed: boolean, detail: string) {
    result.steps.push({ name, passed, detail });
    if (!passed) result.passed = false;
    c.log(passed ? 'info' : 'info', `${passed ? '✓' : '✗'} ${name}`, detail);
  }

  const buildPrompt = options?.buildPrompt
    ?? 'Build a polished fitness dashboard with dark theme, workout tracker with exercise cards, meal planner with calorie tracking, and Google OAuth login page — use Tailwind, Framer Motion animations, and Lucide icons';
  const iteratePrompt = options?.iteratePrompt
    ?? 'Add a progress chart section showing weekly workout stats with an animated bar chart, and add a grocery list feature that generates items from the meal plan';

  // ═══ Setup ═══
  c.setOverlayVisible(true);
  c.setRecording(true);
  c.setLabel('Build Agent');
  c.log('info', '🏗️ Full Build Flow: Starting new app build', 'Simulated cursor drives the entire UI');
  c.moveTo(window.innerWidth / 2, window.innerHeight / 2);
  await sleep(800);

  // ═══ Phase 0: Ensure sandbox + conversation are attached ═══
  c.log('info', '🔗 Phase 0: Attaching to existing sandbox...');
  const hadSandbox = await ensureSandboxAttached();
  if (hadSandbox) {
    step('Sandbox attached', true, `Project: ${useSandboxStore.getState().projectId}, port: ${useSandboxStore.getState().devPort}`);
  }
  await ensureConversationLoaded();
  // Set builder mode in layout
  useLayoutStore.getState().setMode('builder');
  await sleep(500);

  // ═══ Phase 1: Switch to Builder mode ═══
  c.log('info', '🔧 Phase 1: Entering Builder mode');
  const modeBtn = elByText('builder', 'button') ?? elCenter('[data-mode="builder"]');
  if (modeBtn) {
    c.moveTo(modeBtn.x, modeBtn.y);
    await sleep(400);
    c.click(modeBtn.x, modeBtn.y);
    modeBtn.el.click();
    await sleep(800);
    step('Enter Builder mode', true, 'Clicked builder mode');
  } else {
    c.pressKeys(['Ctrl', '3'], 'Ctrl+3');
    await sleep(300);
    c.releaseKeys();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }));
    await sleep(800);
    step('Enter Builder mode', true, 'Ctrl+3 shortcut');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Phase 2: Type and send the build prompt ═══
  c.log('info', '💬 Phase 2: Sending build prompt');
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea) {
    step('Find chat input', false, 'No textarea in DOM');
    return cleanup(result);
  }

  await visualType(textarea, buildPrompt, signal);
  c.screenshot();
  step('Typed build prompt', true, `"${buildPrompt.slice(0, 60)}..."`);
  if (signal?.aborted) return cleanup(result);

  // Send it
  const sendBtn = elCenter('button[type="submit"]')
    ?? elCenter('[data-testid="send-button"]')
    ?? elByText('send', 'button');
  if (sendBtn) {
    c.moveTo(sendBtn.x, sendBtn.y);
    await sleep(300);
    c.click(sendBtn.x, sendBtn.y);
    sendBtn.el.click();
  } else {
    c.pressKeys(['Enter'], 'Enter');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(200);
    c.releaseKeys();
  }
  step('Sent build prompt', true, 'Message sent to Vai');
  await sleep(1500);
  if (signal?.aborted) return cleanup(result);

  // ═══ Phase 3: Watch for response + sandbox creation ═══
  c.log('info', '⏳ Phase 3: Waiting for Vai to build...');
  c.setLabel('Watching');

  let sandboxReady = false;
  for (let i = 0; i < 45; i++) {
    if (signal?.aborted) break;
    await sleep(2000);
    const elapsed = (i + 1) * 2;

    // Visual feedback — move cursor near streaming content
    const streamingEl = document.querySelector('[data-streaming="true"]');
    if (streamingEl) {
      const rect = streamingEl.getBoundingClientRect();
      c.moveTo(rect.left + Math.random() * 200, rect.top + rect.height * 0.7);
    }

    if (elapsed % 8 === 0) {
      c.log('info', `⏳ Building... ${elapsed}s`);
      c.screenshot();
    }

    // Check if sandbox spun up via API
    try {
      const res = await fetch(`${API_BASE}/api/sandbox`);
      const projects = await res.json() as { id: string; status: string; devPort: number | null }[];
      const running = projects.filter(p => p.status === 'running' && p.devPort);
      if (running.length > 0) {
        sandboxReady = true;
        step('Sandbox created', true, `Project running on port ${running[0].devPort}`);
        break;
      }
    } catch { /* still building */ }

    // Also check if response is done (no more streaming)
    if (elapsed > 20) {
      const msgs = document.querySelectorAll('[data-role="assistant"]');
      if (msgs.length > 0 && !streamingEl) {
        // Response done but no sandbox yet — wait a bit more for auto-sandbox
        c.log('info', 'Response complete, waiting for auto-sandbox...');
        await sleep(8000);
        // Check one more time
        try {
          const res = await fetch(`${API_BASE}/api/sandbox`);
          const projects = await res.json() as { id: string; status: string; devPort: number | null }[];
          const running = projects.filter(p => p.status === 'running' && p.devPort);
          if (running.length > 0) {
            sandboxReady = true;
            step('Sandbox created', true, `Project running on port ${running[0].devPort}`);
          } else {
            step('Sandbox created', false, 'Response complete but no sandbox started');
          }
        } catch {
          step('Sandbox created', false, 'Could not check sandbox status');
        }
        break;
      }
    }
  }

  if (!sandboxReady && !result.steps.some(s => s.name === 'Sandbox created')) {
    step('Sandbox created', false, 'Timed out after 90s');
  }
  c.screenshot();
  if (signal?.aborted) return cleanup(result);

  // ═══ Phase 4: Explore Code view ═══
  c.setLabel('Code Review');
  c.log('info', '📂 Phase 4: Exploring Code view');
  await sleep(1500);

  const codeBtn = elByText('code', 'button');
  if (codeBtn) {
    c.moveTo(codeBtn.x, codeBtn.y);
    await sleep(400);
    c.click(codeBtn.x, codeBtn.y);
    codeBtn.el.click();
    await sleep(2000);

    // Look for file tabs and click through a few
    const fileBtns = document.querySelectorAll('button');
    const fileButtons: HTMLElement[] = [];
    fileBtns.forEach(btn => {
      const text = btn.textContent?.trim() ?? '';
      if (text.match(/\.(tsx?|jsx?|css|json)$/) && !text.includes('node_modules')) {
        fileButtons.push(btn as HTMLElement);
      }
    });

    if (fileButtons.length > 0) {
      step('Code view shows files', true, `${fileButtons.length} source files visible`);

      // Click through first 3 files
      for (let fi = 0; fi < Math.min(3, fileButtons.length); fi++) {
        const fb = fileButtons[fi];
        const rect = fb.getBoundingClientRect();
        c.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
        await sleep(500);
        c.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
        fb.click();
        c.log('info', `📄 Viewing: ${fb.textContent?.trim()}`);
        await sleep(1200);
        c.screenshot();
      }
      step('Browse files', true, `Clicked through ${Math.min(3, fileButtons.length)} files`);
    } else {
      step('Code view shows files', false, 'No file buttons found');
    }
  } else {
    step('Code view shows files', false, 'Code button not found');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Phase 5: Switch to Preview ═══
  c.setLabel('Preview Check');
  c.log('info', '👁️ Phase 5: Checking live preview');

  const prevBtn = elByText('preview', 'button');
  if (prevBtn) {
    c.moveTo(prevBtn.x, prevBtn.y);
    await sleep(400);
    c.click(prevBtn.x, prevBtn.y);
    prevBtn.el.click();
    await sleep(2500);

    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.src) {
      step('Preview is live', true, `iframe: ${iframe.src}`);
      c.screenshot();

      // Move cursor around the preview area to simulate inspection
      const iRect = iframe.getBoundingClientRect();
      for (let scan = 0; scan < 4; scan++) {
        const sx = iRect.left + (iRect.width * (scan + 1)) / 5;
        const sy = iRect.top + iRect.height * 0.4;
        c.moveTo(sx, sy);
        await sleep(600);
      }
      c.screenshot();
    } else {
      step('Preview is live', false, 'No iframe found');
    }
  } else {
    step('Preview is live', false, 'Preview button not found');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Phase 6: Iterate — send a follow-up prompt ═══
  c.setLabel('Iterator');
  c.log('info', '🔄 Phase 6: Sending iteration prompt');

  const textarea2 = document.querySelector('textarea') as HTMLTextAreaElement | null;
  if (textarea2) {
    await visualType(textarea2, iteratePrompt, signal);
    c.screenshot();

    const sendBtn2 = elCenter('button[type="submit"]')
      ?? elCenter('[data-testid="send-button"]')
      ?? elByText('send', 'button');
    if (sendBtn2) {
      c.moveTo(sendBtn2.x, sendBtn2.y);
      await sleep(300);
      c.click(sendBtn2.x, sendBtn2.y);
      sendBtn2.el.click();
    } else {
      c.pressKeys(['Enter'], 'Enter');
      textarea2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(200);
      c.releaseKeys();
    }
    step('Sent iteration prompt', true, `"${iteratePrompt.slice(0, 50)}..."`);

    // Wait for response
    c.log('info', '⏳ Waiting for iteration response...');
    for (let i = 0; i < 30; i++) {
      if (signal?.aborted) break;
      await sleep(2000);
      const elapsed = (i + 1) * 2;

      const streaming = document.querySelector('[data-streaming="true"]');
      if (!streaming && i > 3) {
        const msgs = document.querySelectorAll('[data-role="assistant"]');
        if (msgs.length >= 2) {
          step('Iteration response', true, `Got response after ${elapsed}s`);
          break;
        }
      }
      if (elapsed % 10 === 0) {
        c.log('info', `⏳ Iterating... ${elapsed}s`);
        c.screenshot();
      }
    }
  } else {
    step('Sent iteration prompt', false, 'Textarea not found');
  }
  if (signal?.aborted) return cleanup(result);

  // ═══ Phase 7: Final verification — Code + Preview cycle ═══
  c.setLabel('Final Check');
  c.log('info', '✅ Phase 7: Final verification');
  await sleep(2000);

  // Switch to Code one more time
  const codeBtn2 = elByText('code', 'button');
  if (codeBtn2) {
    c.moveTo(codeBtn2.x, codeBtn2.y);
    await sleep(300);
    c.click(codeBtn2.x, codeBtn2.y);
    codeBtn2.el.click();
    await sleep(1500);
    c.screenshot();
  }

  // Switch to Preview
  const prevBtn2 = elByText('preview', 'button');
  if (prevBtn2) {
    c.moveTo(prevBtn2.x, prevBtn2.y);
    await sleep(300);
    c.click(prevBtn2.x, prevBtn2.y);
    prevBtn2.el.click();
    await sleep(2000);
    c.screenshot();
  }

  // Check for stale UI text
  const badPill = elByText('Preview code mode is ready');
  step('UI text clean', !badPill, badPill ? 'Stale pill text found' : 'No stale status text');

  // ═══ Summary ═══
  c.log('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const passed = result.steps.filter(s => s.passed).length;
  const total = result.steps.length;
  c.log('info', `🏗️ Build Flow Complete: ${passed}/${total} checks passed`, result.passed ? 'ALL PASSED' : 'SOME FAILED');
  for (const s of result.steps) {
    c.log('info', `  ${s.passed ? '✓' : '✗'} ${s.name}`, s.detail);
  }
  c.screenshot();

  return cleanup(result);
}

/* ── Expose globally ─────────────────────────────────────── */

export function exposeQAGlobal() {
  const api = {
    /** Run full visual QA sequence (verify existing state) */
    run: (options?: { prompt?: string; skipSend?: boolean }) => {
      const controller = new AbortController();
      const promise = runVisualQA(controller.signal, options);
      return { promise, abort: () => controller.abort() };
    },

    /** Quick verify — skip sending, just check current UI state */
    verify: () => {
      const controller = new AbortController();
      const promise = runVisualQA(controller.signal, { skipSend: true });
      return { promise, abort: () => controller.abort() };
    },

    /** Full build flow — build a new app, iterate, test Code/Preview */
    build: (options?: { buildPrompt?: string; iteratePrompt?: string }) => {
      const controller = new AbortController();
      const promise = runFullBuildFlow(controller.signal, options);
      return { promise, abort: () => controller.abort() };
    },

    /** Attach to a running sandbox + load conversation (no visual cursor) */
    attach: async () => {
      const attached = await ensureSandboxAttached();
      const loaded = await ensureConversationLoaded();
      return { sandbox: attached, conversation: loaded };
    },
  };

  (window as unknown as Record<string, unknown>).__vai_qa = api;
}

// Auto-expose on load
exposeQAGlobal();

// HMR support
if ((import.meta as unknown as { hot?: { accept: (cb: () => void) => void } }).hot) {
  (import.meta as unknown as { hot: { accept: (cb: () => void) => void } }).hot.accept(() => exposeQAGlobal());
}
