/**
 * Visible-browser demo: sidebar interactions + multi-chat conversations + response capture.
 *
 * Steps:
 *  1. Launch real visible Chromium on http://localhost:5173 at 1920x1080.
 *  2. Toggle fullscreen ON, screenshot to verify sidebar layout fix.
 *  3. Open the sidebar (Ctrl+S cycles state).
 *  4. For each scripted conversation: click "New chat", type prompt, wait for
 *     assistant response, capture full text + DOM list/table counts.
 *  5. Save all conversation responses to scripts/screenshots/r30-demo/responses.json.
 *  6. Print a numbered review of every response.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'scripts/screenshots/r30-demo';
const APP = process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1';
fs.mkdirSync(OUT, { recursive: true });

function ts() { return new Date().toISOString(); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

const CONVERSATIONS = [
  {
    title: 'Capitals + planets',
    prompts: [
      'what is the capital of Norway?',
      'list the 8 planets of our solar system as a numbered list, in order from the sun',
    ],
  },
  {
    title: 'Science explainers',
    prompts: [
      'in one sentence, what is the mitochondria?',
      'explain photosynthesis',
      'what is general relativity?',
    ],
  },
  {
    title: 'Tech facts',
    prompts: [
      'explain HTTP in prose, no bullet points, no list — just plain text',
      'give me 5 differences between TCP and UDP as bullet points',
    ],
  },
  {
    title: 'People + history',
    prompts: [
      'who is Karl Marx?',
      'tell me about the Cold War',
    ],
  },
];

async function readLastAssistantText(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-chat-message-role="assistant"]');
    const last = nodes[nodes.length - 1];
    if (!last) return { text: '', orderedItems: 0, unorderedItems: 0, tableRows: 0 };
    const text = (last.innerText || '').trim();
    return {
      text,
      orderedItems: last.querySelectorAll('ol > li').length,
      unorderedItems: last.querySelectorAll('ul > li').length,
      tableRows: last.querySelectorAll('table tr').length,
    };
  });
}

async function waitForSettled(page, timeoutMs = 240_000) {
  const start = Date.now();
  let lastSeenLen = -1;
  let stableTicks = 0;
  while (Date.now() - start < timeoutMs) {
    const streaming = await page.locator('[data-streaming]').count();
    const stopBtn = await page.locator('button[title="Stop generating"]').count();
    const dom = await readLastAssistantText(page);
    if (streaming === 0 && stopBtn === 0 && dom.text.length > 0) {
      if (dom.text.length === lastSeenLen) {
        stableTicks++;
        if (stableTicks >= 3) return dom;
      } else {
        stableTicks = 0;
        lastSeenLen = dom.text.length;
      }
    }
    await page.waitForTimeout(500);
  }
  return readLastAssistantText(page);
}

async function clickNewChat(page) {
  // Try several reasonable selectors
  const candidates = [
    'button:has-text("New Chat")',
    'button:has-text("New chat")',
    '[aria-label="New chat" i]',
    '[title="New chat" i]',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  // Fallback: hard reload to start a fresh conversation visually
  const u = new URL(page.url());
  u.searchParams.set('devAuthBypass', '1');
  u.searchParams.set('_new', String(Date.now()));
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  return true;
}

async function ensureSidebarExpanded(page) {
  // Ctrl+S cycles expanded → rail → hidden. Press up to 3 times to land on expanded.
  for (let i = 0; i < 3; i++) {
    const expandedNow = await page.evaluate(() =>
      Boolean(document.querySelector('[data-chat-message-role="assistant"]') ||
              document.querySelector('aside, nav'))
    );
    // Heuristic: look for sidebar header text "Chat History"
    const hasHeader = await page.locator('text=Chat History').count();
    if (hasHeader > 0) return true;
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(400);
    expandedNow; // unused
  }
  return (await page.locator('text=Chat History').count()) > 0;
}

(async () => {
  log('launching chromium (visible)…');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 60,
    args: ['--no-sandbox', '--start-maximized'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') log(`browser.error: ${m.text().slice(0, 200)}`);
  });

  log(`open ${APP}`);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '01-initial.png'), fullPage: false });

  // Sidebar layout verification — capture default windowed
  log('screenshot windowed (default 1920x1080)…');
  await page.screenshot({ path: path.join(OUT, '02-windowed.png') });

  // Try fullscreen via F11 keyboard, then capture
  log('toggle fullscreen via F11…');
  await page.keyboard.press('F11');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '03-fullscreen.png') });

  log('toggle out of fullscreen…');
  await page.keyboard.press('F11');
  await page.waitForTimeout(800);

  // Ensure sidebar is visible (expanded)
  log('opening sidebar…');
  await ensureSidebarExpanded(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '04-sidebar-open.png') });

  const results = [];
  for (let cIdx = 0; cIdx < CONVERSATIONS.length; cIdx++) {
    const conv = CONVERSATIONS[cIdx];
    log(`=== conversation ${cIdx + 1}/${CONVERSATIONS.length}: ${conv.title} ===`);

    // Create a fresh chat
    log('clicking New chat…');
    await clickNewChat(page);
    await page.waitForTimeout(1200);
    // Re-ensure sidebar visible after potential reload
    await ensureSidebarExpanded(page);
    // Wait for textarea to be ready (chat view)
    await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, `c${cIdx + 1}-00-newchat.png`) });

    const responses = [];
    for (let pIdx = 0; pIdx < conv.prompts.length; pIdx++) {
      const prompt = conv.prompts[pIdx];
      log(`  prompt ${pIdx + 1}/${conv.prompts.length}: ${prompt}`);
      const ta = page.locator('textarea').first();
      await ta.click();
      await ta.fill(prompt);
      await page.screenshot({ path: path.join(OUT, `c${cIdx + 1}-p${pIdx + 1}-typed.png`) });
      await ta.press('Enter');

      const dom = await waitForSettled(page);
      log(`    settled chars=${dom.text.length} ol=${dom.orderedItems} ul=${dom.unorderedItems} tr=${dom.tableRows}`);
      await page.screenshot({ path: path.join(OUT, `c${cIdx + 1}-p${pIdx + 1}-response.png`) });
      responses.push({ prompt, ...dom });
    }
    results.push({ conversation: conv.title, responses });
  }

  // Final scroll-through screenshot of last conversation
  await page.screenshot({ path: path.join(OUT, '99-final.png'), fullPage: true });

  fs.writeFileSync(path.join(OUT, 'responses.json'), JSON.stringify(results, null, 2));
  log(`wrote ${path.join(OUT, 'responses.json')}`);

  // Console review
  console.log('');
  console.log('================ REVIEW ================');
  let i = 0;
  for (const c of results) {
    console.log(`\n## Conversation: ${c.conversation}`);
    for (const r of c.responses) {
      i++;
      console.log(`\n[${i}] PROMPT: ${r.prompt}`);
      console.log(`    LEN=${r.text.length}  ol=${r.orderedItems}  ul=${r.unorderedItems}  tr=${r.tableRows}`);
      const preview = r.text.replace(/\s+/g, ' ').slice(0, 360);
      console.log(`    RESPONSE: ${preview}${r.text.length > 360 ? '…' : ''}`);
    }
  }

  log('keeping browser open 6s for visual confirmation…');
  await page.waitForTimeout(6000);
  await browser.close();
  log('done');
})().catch(err => { console.error(err); process.exit(1); });
