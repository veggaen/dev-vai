/**
 * VaiGymRunner — Visual automation for the Vai Training Gymnasium.
 *
 * Uses the existing cursorStore + DemoSequence infrastructure to make
 * Vai's cursor visibly navigate the gym, select scenarios, type responses,
 * submit for grading, and review results — all in real time.
 *
 * Triggered by the "Watch Vai" button in the gym nav or via
 * window.__vai_gym.runTrainingRound().
 */

import { useVaiGymStore, FOUNDATIONS } from '../stores/vaiGymStore.js';
import { useCursorStore } from '../stores/cursorStore.js';


const API_BASE = 'http://localhost:3006';

/* ── Helpers ───────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function getCursor() {
  return useCursorStore.getState();
}

function getGym() {
  return useVaiGymStore.getState();
}

/* ── Build a training round demo sequence ──────────────────────── */

/**
 * Run a full visual training round:
 * 1. Navigate to Dashboard tab
 * 2. Select foundation/difficulty
 * 3. Click "From Scenario Bank"
 * 4. Scenario appears → type Vai's response
 * 5. Submit for grading
 * 6. Review results
 * 7. Return to dashboard
 */
export async function runVisualTrainingRound(
  signal?: AbortSignal,
  options?: {
    foundation?: string;
    difficulty?: string;
    cursorLabel?: string;
  },
): Promise<void> {
  const gym = getGym();
  const cursor = getCursor();
  const label = options?.cursorLabel ?? 'Vai';
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Log start
  cursor.log('info', `🧠 Vai Gym: Starting visual training round`, `Label: ${label}`);
  cursor.setOverlayVisible(true);

  // Opus sets up the round (mentor label)
  cursor.setLabel('Opus');
  cursor.moveTo(w * 0.5, h * 0.5);

  // Step 1: Ensure we're on the gym view
  gym.setRunnerActive(true);
  gym.setRunnerStep('Opus: Setting up training round');

  // Click the gym nav if not already there
  const dashTab = document.querySelector('[data-vai-gym-nav="dashboard"]') as HTMLElement | null;
  if (dashTab) {
    const rect = dashTab.getBoundingClientRect();
    cursor.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await sleep(400);
    cursor.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
    dashTab.click();
  }
  gym.setView('dashboard');
  await sleep(600);
  if (signal?.aborted) return cleanup();

  // Step 2: Set foundation and difficulty
  const foundation = options?.foundation ?? FOUNDATIONS[Math.floor(Math.random() * FOUNDATIONS.length)].id;
  const difficulty = options?.difficulty ?? 'apprentice';
  gym.setSelectedFoundation(foundation);
  gym.setSelectedDifficulty(difficulty);
  gym.setRunnerStep(`Selected: ${FOUNDATIONS.find(f => f.id === foundation)?.name} (${difficulty})`);
  cursor.log('info', `Foundation: ${FOUNDATIONS.find(f => f.id === foundation)?.name}`, `Difficulty: ${difficulty}`);
  await sleep(800);
  if (signal?.aborted) return cleanup();

  // Step 3: Start a random scenario from the bank
  gym.setRunnerStep('Opus: Selecting scenario for Vai...');
  const bankBtn = document.querySelector('[data-vai-gym-bank-btn]') as HTMLElement | null;
  if (bankBtn) {
    const rect = bankBtn.getBoundingClientRect();
    cursor.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await sleep(300);
    cursor.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await sleep(200);
  }
  gym.startRandomScenario();
  await sleep(800);
  if (signal?.aborted) return cleanup();

  const scenario = useVaiGymStore.getState().activeScenario;
  if (!scenario) {
    cursor.log('info', 'No scenario available for this filter', 'Ending round');
    return cleanup();
  }

  cursor.log('info', `Scenario: ${scenario.situation.substring(0, 60)}...`);
  // Hand control to Vai
  cursor.setLabel(label);
  gym.setRunnerStep(`${label}: Formulating response...`);
  await sleep(500);
  if (signal?.aborted) return cleanup();

  // Step 4: Generate Vai's response via the /api/vai/train endpoint
  // (generates a response using Claude, then grades it)
  let vaiResponse: string;
  try {
    const trainRes = await fetch(`${API_BASE}/api/vai/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foundation, difficulty, response: undefined }),
    });
    if (trainRes.ok) {
      const data = await trainRes.json() as { response: string };
      vaiResponse = data.response ?? 'I need to think about this more carefully...';
    } else {
      // Fallback: use a placeholder response
      vaiResponse = `Looking at this from first principles: the key question isn't "${scenario.situation.substring(0, 40)}..." but rather what underlying need drives this. Let me think about what's really being asked here and provide a precise, actionable answer rather than a generic one.`;
    }
  } catch {
    vaiResponse = 'Let me approach this step by step, starting from the fundamentals...';
  }
  if (signal?.aborted) return cleanup();

  // Step 5: Visually type the response into the textarea (Vai typing)
  gym.setRunnerStep(`${label}: Typing response...`);
  gym.setResponse(''); // Clear any previous response
  const textarea = document.querySelector('[data-vai-gym-textarea]') as HTMLTextAreaElement | null;
  if (textarea) {
    const rect = textarea.getBoundingClientRect();
    cursor.moveTo(rect.left + 20, rect.top + 20);
    await sleep(300);
    cursor.click(rect.left + 20, rect.top + 20);
    textarea.focus();
    await sleep(200);

    // Type character by character — update BOTH keyboard overlay AND textarea
    const len = vaiResponse.length;
    // Adaptive speed: 50ms/char for short, down to 8ms for long, max ~8s total
    const charDelay = Math.max(8, Math.min(50, 8000 / len));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

    // Show keyboard overlay
    useCursorStore.setState({
      kbVisible: true,
      cursor: { ...cursor.cursor, x: rect.left + 20, y: rect.top + 20, visible: true, typing: true, hovering: false },
    });

    for (let i = 0; i < len; i++) {
      if (signal?.aborted) {
        // Finalize on abort
        gym.setResponse(vaiResponse);
        break;
      }
      const ch = vaiResponse[i];
      // Highlight key on keyboard overlay
      useCursorStore.setState({ kbActiveKey: ch || null });
      // Progressively build the response in the store (React updates textarea)
      const partial = vaiResponse.substring(0, i + 1);
      gym.setResponse(partial);
      // Also set native value for visual consistency
      if (setter) {
        setter.call(textarea, partial);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Scroll textarea to bottom so new chars are visible
      textarea.scrollTop = textarea.scrollHeight;
      await sleep(charDelay);
    }

    // Hide keyboard overlay
    useCursorStore.setState({
      kbActiveKey: null,
      kbVisible: false,
      cursor: { ...useCursorStore.getState().cursor, typing: false },
    });
  } else {
    gym.setResponse(vaiResponse);
  }
  if (signal?.aborted) return cleanup();

  await sleep(600);
  cursor.screenshot();
  await sleep(400);

  // Step 6: Submit for grading (Vai submits)
  gym.setRunnerStep(`${label}: Submitting for grading...`);
  const submitBtn = document.querySelector('[data-vai-gym-submit]') as HTMLElement | null;
  if (submitBtn) {
    const rect = submitBtn.getBoundingClientRect();
    cursor.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await sleep(300);
    cursor.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await sleep(200);
  }

  // Actually submit
  cursor.log('info', `${label}: Submitting response for grading...`);
  await gym.submitResponse();
  await sleep(800);
  if (signal?.aborted) return cleanup();

  // Step 7: Review results (Opus reviews)
  cursor.setLabel('Opus');
  const grade = useVaiGymStore.getState().lastGrade;
  if (grade) {
    gym.setRunnerStep(`Opus reviewing: ${grade.overall}/100`);
    cursor.log('info', `Grade: ${grade.overall}/100`, grade.feedback?.substring(0, 100));
    cursor.screenshot();
    await sleep(2000);

    // Scroll through the review
    cursor.scroll(-200);
    await sleep(800);
    cursor.scroll(-200);
    await sleep(800);
  }
  if (signal?.aborted) return cleanup();

  // Step 8: Back to dashboard
  cursor.setLabel('Opus');
  gym.setRunnerStep('Opus: Round complete — back to dashboard');
  gym.setView('dashboard');
  await sleep(1000);
  cursor.screenshot();
  cursor.log('info', `🧠 Training round complete — Score: ${grade?.overall ?? '?'}/100`);

  cleanup();

  function cleanup() {
    gym.setRunnerActive(false);
    gym.setRunnerStep('');
    cursor.hide();
  }
}

/**
 * Run multiple visual training rounds in sequence.
 */
export async function runVisualTrainingSession(
  rounds = 3,
  signal?: AbortSignal,
  options?: {
    foundation?: string;
    difficulty?: string;
    cursorLabel?: string;
  },
): Promise<void> {
  const cursor = getCursor();
  cursor.log('info', `🏋️ Starting training session: ${rounds} rounds`);

  for (let i = 0; i < rounds; i++) {
    if (signal?.aborted) break;
    cursor.log('info', `Round ${i + 1}/${rounds}`);
    await runVisualTrainingRound(signal, options);
    if (signal?.aborted) break;
    await sleep(1500); // Brief pause between rounds
  }

  cursor.log('info', `🏋️ Training session complete`);
}

/* ── Global API for external scripts (Puppeteer) ───────────────── */

export function exposeGymAPI() {
  (window as unknown as Record<string, unknown>).__vai_gym = {
    runTrainingRound: (opts?: { foundation?: string; difficulty?: string; cursorLabel?: string }) => {
      const ctrl = new AbortController();
      const promise = runVisualTrainingRound(ctrl.signal, opts);
      return { promise, abort: () => ctrl.abort() };
    },
    runTrainingSession: (rounds?: number, opts?: { foundation?: string; difficulty?: string; cursorLabel?: string }) => {
      const ctrl = new AbortController();
      const promise = runVisualTrainingSession(rounds, ctrl.signal, opts);
      return { promise, abort: () => ctrl.abort() };
    },
    getProgress: () => useVaiGymStore.getState().progress,
    getStore: () => useVaiGymStore.getState(),
    // Direct state mutations for Puppeteer automation
    setResponse: (text: string) => useVaiGymStore.getState().setResponse(text),
    submitResponse: () => useVaiGymStore.getState().submitResponse(),
    startRandomScenario: () => useVaiGymStore.getState().startRandomScenario(),
    setView: (view: string) => useVaiGymStore.getState().setView(view as 'dashboard' | 'training' | 'review' | 'foundations' | 'history'),
  };
}
