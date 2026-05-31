#!/usr/bin/env node
/**
 * Chat-quality scale scanner.
 *
 * Throws a broad bank of real-user questions at the live runtime chat engine
 * and auto-flags likely misroutes with "smell" detectors (no hand-labeled
 * answers needed for most). Prints a pass rate + failures grouped by smell,
 * so we can measure conversation quality before/after engine changes.
 *
 * Usage: node scripts/vai-chat-quality-scan.mjs [--ws ws://127.0.0.1:3006/api/chat?devAuthBypass=1] [--only action,definition]
 */
const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }
const WS = arg('--ws', 'ws://127.0.0.1:3006/api/chat?devAuthBypass=1');
const onlyTags = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const full = args.includes('--full'); // print the full answer for every question

// ── Question bank ────────────────────────────────────────────────────────────
// intent: action-yesno | definition | factual | compound | trap | refusal-test
// forbid: regexes that, if matched, indicate a misroute (FAIL)
// expect: regexes that SHOULD appear (at least one) — soft signal of a real answer
const Q = [
  // action yes/no about brands/products — must NOT dump a "what is X" definition
  { q: 'does starbucks make cappuccino?', intent: 'action-yesno', forbid: [/coffeehouse chain|largest coffee chain|founded in \d{4}/i], expect: [/cappuccino|espresso|yes|coffee drink/i] },
  { q: 'does mcdonalds sell salads?', intent: 'action-yesno', forbid: [/fast[- ]food chain|founded in \d{4}|headquarter/i], expect: [/salad|yes|menu/i] },
  { q: 'does nike make running shoes?', intent: 'action-yesno', forbid: [/athletic footwear and apparel brand|"swoosh"|just do it/i], expect: [/shoe|running|yes/i] },
  { q: 'does tesla make phones?', intent: 'action-yesno', forbid: [/electric (car|vehicle) (company|manufacturer)|founded in \d{4}/i], expect: [/no|phone|don'?t|doesn'?t/i] },
  { q: 'does spotify have podcasts?', intent: 'action-yesno', forbid: [/music.{0,20}streaming service|launched in 2008|stockholm/i], expect: [/podcast|yes/i] },
  { q: 'does amazon sell groceries?', intent: 'action-yesno', forbid: [/e-commerce.{0,20}(company|giant)|founded in \d{4}/i], expect: [/grocer|whole foods|fresh|yes/i] },
  { q: 'does ikea sell food?', intent: 'action-yesno', forbid: [/furniture (retailer|company|brand)|founded in \d{4}|swedish furniture/i], expect: [/food|meatball|yes|restaurant/i] },
  { q: 'does google make phones?', intent: 'action-yesno', forbid: [/search engine.{0,20}(company)?|founded in 1998/i], expect: [/pixel|phone|yes/i] },
  { q: 'does tine make rislunsj?', intent: 'action-yesno', forbid: [/scaffold|tell me the (language|framework)|i'?ll build|first runnable|where they make sense/i], expect: [/tine|rislunsj|dairy|rice|yes|not sure|don'?t have/i] },
  { q: 'does adidas make football boots?', intent: 'action-yesno', forbid: [/three-stripe|founded in 1949|adolf dassler/i], expect: [/boot|football|soccer|cleat|yes/i] },

  // definitions — must be on-topic
  { q: 'what is docker?', intent: 'definition', forbid: [/jurisdiction|contract terms|legal advice/i], expect: [/container/i] },
  { q: 'what is a vpn?', intent: 'definition', forbid: [], expect: [/encrypt|tunnel|network/i] },
  { q: 'what was the paris agreement?', intent: 'trap', forbid: [/jurisdiction|contract terms|late.?fee|legal advice|deliverables/i], expect: [/climate|emission|greenhouse|treaty|warming|2015/i] },
  { q: 'who is elon musk?', intent: 'definition', forbid: [/jurisdiction|contract terms/i], expect: [/tesla|spacex|ceo|entrepreneur/i] },
  { q: 'what is photosynthesis?', intent: 'definition', forbid: [], expect: [/light|plant|energy|carbon|chlorophyll/i] },
  { q: 'what is kubernetes?', intent: 'definition', forbid: [], expect: [/container|orchestrat|cluster/i] },

  // factual lookups
  { q: 'what is the capital of france?', intent: 'factual', forbid: [], expect: [/paris/i] },
  { q: 'who invented the light bulb?', intent: 'factual', forbid: [], expect: [/edison|swan/i] },
  { q: 'what is the currency of japan?', intent: 'factual', forbid: [], expect: [/yen/i] },
  { q: 'what is the tallest mountain in the world?', intent: 'factual', forbid: [], expect: [/everest/i] },
  { q: 'what is the capital of australia?', intent: 'factual', forbid: [], expect: [/canberra/i] },

  // compound — must address BOTH parts
  { q: 'does starbucks make cappuccino and does mcdonalds sell burgers?', intent: 'compound', forbid: [/coffeehouse chain|largest coffee chain/i], expect: [/burger/i], expectAlso: [/cappuccino|coffee/i] },
  { q: 'what is the capital of france and the capital of germany?', intent: 'compound', forbid: [], expect: [/paris/i], expectAlso: [/berlin/i] },
  { q: 'is the sky blue and is grass green?', intent: 'compound', forbid: [/rainbow|seven.{0,10}stripe|flag/i], expect: [/sky/i], expectAlso: [/grass|green/i] },

  // refusal calibration — should attempt, not over-refuse common knowledge
  { q: 'explain quantum chromodynamics', intent: 'refusal-test', forbid: [/isn'?t in my knowledge|not ready ground|haven'?t learned|scaffold/i], expect: [/quark|gluon|strong (force|interaction)|qcd|nuclear/i] },
  { q: 'can dogs eat chocolate?', intent: 'action-yesno', forbid: [/scaffold|framework/i], expect: [/no|toxic|harmful|theobromine|avoid/i] },
];

// Global smell detectors applied to every answer
function globalSmells(intent, text) {
  const smells = [];
  const t = text.toLowerCase();
  // builder leak in a plain chat question
  if (/\b(scaffold|tell me the (language|framework|stack)|i'?ll (build|scaffold)|first runnable version|reply with only|fenced code blocks)\b/i.test(text)
      && intent !== 'build') smells.push('builder-leak');
  // legal-advice misroute
  if (/\b(jurisdiction|contract terms|late.?fee clause|issue-spotting|not legal advice)\b/i.test(text)
      && intent !== 'legal') smells.push('legal-misroute');
  // definition dump for a non-definition question (starts by defining the entity)
  if ((intent === 'action-yesno' || intent === 'compound')
      && /^\s*\*?\*?[A-Z][\w'&.\- ]{1,30}\*?\*? is an? /.test(text)) smells.push('definition-dump');
  // confident Yes with no substance
  if (/^\s*\*\*yes\*\*\s*[—-]\s*/i.test(text) && text.length < 40) smells.push('thin-yes');
  // over-refusal
  if (/\b(isn'?t in my knowledge( yet)?|haven'?t learned (this|that|enough)|i don'?t have (enough )?(knowledge|info))\b/i.test(text)) smells.push('over-refusal');
  return smells;
}

function rid() { return 'scan-' + Math.random().toString(36).slice(2); }

async function ask(ws, content) {
  const convoId = rid();
  let text = '', turnKind = '';
  const finished = new Promise((resolve) => {
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'turn_kind') turnKind = m.turnKind || '';
      else if (m.type === 'text_delta') text += m.textDelta || '';
      else if (m.type === 'error') { text = `[ERROR] ${m.error}`; resolve(); }
      else if (m.type === 'done') resolve();
    };
  });
  ws.send(JSON.stringify({ conversationId: convoId, content, mode: 'chat', modelId: 'vai:v0' }));
  await finished;
  return { turnKind, text: text.trim() };
}

function evaluate(item, text) {
  const reasons = [];
  for (const rx of item.forbid || []) if (rx.test(text)) reasons.push(`forbidden:${rx.source.slice(0, 30)}`);
  const expectOk = !item.expect || item.expect.some((rx) => rx.test(text));
  if (!expectOk) reasons.push('missing-expected');
  if (item.expectAlso && !item.expectAlso.some((rx) => rx.test(text))) reasons.push('compound-2nd-part-missing');
  const smells = globalSmells(item.intent, text);
  reasons.push(...smells.map((s) => `smell:${s}`));
  return { pass: reasons.length === 0, reasons };
}

async function main() {
  const bank = onlyTags.length ? Q.filter((x) => onlyTags.includes(x.intent)) : Q;
  const ws = new WebSocket(WS);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const results = [];
  for (const item of bank) {
    const { turnKind, text } = await ask(ws, item.q);
    const { pass, reasons } = evaluate(item, text);
    results.push({ ...item, turnKind, text, pass, reasons });
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(`[${tag}] (${item.intent}) ${item.q}`);
    if (!pass) console.log(`        reasons: ${reasons.join(', ')}`);
    if (full || !pass) {
      const body = full ? text.replace(/\n+/g, ' ⏎ ') : text.slice(0, 160).replace(/\n/g, ' ');
      console.log(`        got: ${body}`);
    }
  }
  ws.close();

  const passed = results.filter((r) => r.pass).length;
  const byIntent = {};
  const bySmell = {};
  for (const r of results) {
    byIntent[r.intent] ??= { pass: 0, total: 0 };
    byIntent[r.intent].total += 1;
    if (r.pass) byIntent[r.intent].pass += 1;
    for (const reason of r.reasons) { const k = reason.split(':')[0] === 'smell' ? reason : reason.split(':')[0]; bySmell[k] = (bySmell[k] || 0) + 1; }
  }
  console.log(`\n===== SCAN: ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%) =====`);
  console.log('By intent:'); for (const [k, v] of Object.entries(byIntent)) console.log(`  ${k}: ${v.pass}/${v.total}`);
  console.log('Failure reasons:'); for (const [k, v] of Object.entries(bySmell).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
}
main().catch((e) => { console.error('scan failed:', e); process.exit(1); });
