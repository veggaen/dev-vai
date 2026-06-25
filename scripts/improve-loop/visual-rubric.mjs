/**
 * visual-rubric — Vai's evidence-bound visual taste engine.
 *
 * This is the DETERMINISTIC core of Vai's UI judgment. It does NOT look at pixels
 * and "feel" a vibe — that would be exactly the untrustworthy taste-claim the owner
 * warned against. Instead it consumes a `signals` object of things the probe
 * actually MEASURED in the live DOM (computed styles, bounding boxes,
 * elementFromPoint, interaction timing) and turns them into:
 *
 *   - rubric scores across 6 dimensions (composition, motion, interaction feel,
 *     visual identity, emotional quality, plus a derived human-appeal prediction)
 *   - concrete flaw findings with severity P0..P3, each tied to a measured cause
 *   - one reusable "taste lesson"
 *
 * Every score is bounded to a measured signal. If a signal is missing the score is
 * conservative and the reason says "not measured" — never an invented compliment.
 * Models/council may later ADD nuance, but the floor is this measurable contract.
 *
 * Pure + side-effect free → unit-testable without a browser. The probe feeds it the
 * live signals; the operator stores the verdict; the council reads the compact form.
 */

const clamp = (n, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;

/** sRGB relative luminance for WCAG contrast. Accepts {r,g,b} 0..255. */
function relLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse a CSS color string the probe captured (rgb/rgba only — what getComputedStyle returns). */
export function parseCssColor(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const a = parts.length >= 4 ? parts[3] : 1;
  return { r: parts[0], g: parts[1], b: parts[2], a };
}

/**
 * Is this transition/animation timing "expensive"-feeling vs cheap/jarring?
 * Cheap = no easing (linear), too fast to read (<120ms), or so slow it drags (>700ms).
 * Intentional = eased curve in the 150..450ms sweet spot.
 */
export function gradeMotionTiming({ durationMs, easing }) {
  if (durationMs == null) return { score: 5, reason: 'no transition measured (static or instant)' };
  if (durationMs === 0) return { score: 4, reason: 'instant state change — no continuity cue' };
  const eased = typeof easing === 'string' && easing !== 'linear' && easing !== 'none' && easing !== '';
  let score = 5;
  const notes = [];
  if (durationMs < 120) { score -= 2; notes.push(`${durationMs}ms is snappy/abrupt`); }
  else if (durationMs > 700) { score -= 2; notes.push(`${durationMs}ms drags`); }
  else { score += 2; notes.push(`${durationMs}ms reads cleanly`); }
  if (eased) { score += 2; notes.push(`eased (${easing})`); }
  else { score -= 1; notes.push('linear/none easing feels mechanical'); }
  return { score: clamp(score), reason: notes.join('; ') };
}

/** Generic-AI-aesthetic detector. Returns matched failure signs from FAILURE-SIGNS list. */
export function detectGenericAesthetic(signals) {
  const flags = [];
  const s = signals || {};
  // purple-gradient slop: a violet/indigo-dominant gradient used as a hero/background fill.
  if (s.purpleGradientCount > 0) flags.push('purple-gradient slop');
  // meaningless glassmorphism: backdrop-filter blur on many surfaces with low contrast.
  if (s.glassmorphismCount >= 3) flags.push('overused glassmorphism');
  // nested cards: card-like containers nested >=3 deep.
  if (s.maxCardNestingDepth >= 3) flags.push('nested cards');
  // oversized empty hero: a huge element with very little content.
  if (s.oversizedEmptyHero) flags.push('oversized empty hero');
  // weak typography: one or two font sizes total → no hierarchy.
  if (s.distinctFontSizes != null && s.distinctFontSizes <= 2) flags.push('weak typographic hierarchy');
  return flags;
}

function scoreComposition(s) {
  const findings = [];
  let score = 5;
  // Hierarchy: distinct font sizes signal a real type scale (3..6 is healthy).
  if (s.distinctFontSizes != null) {
    if (s.distinctFontSizes >= 3 && s.distinctFontSizes <= 8) { score += 2; findings.push(`${s.distinctFontSizes} type sizes → real hierarchy`); }
    else if (s.distinctFontSizes <= 2) { score -= 2; findings.push('≤2 type sizes → flat hierarchy'); }
    else if (s.distinctFontSizes > 12) { score -= 1; findings.push(`${s.distinctFontSizes} type sizes → noisy scale`); }
  } else findings.push('type scale not measured');
  // Whitespace: 0.25..0.6 painted-area ratio reads calm; too dense or too empty hurts.
  if (s.contentDensity != null) {
    if (s.contentDensity >= 0.2 && s.contentDensity <= 0.6) { score += 1; findings.push(`density ${round1(s.contentDensity)} is balanced`); }
    else if (s.contentDensity > 0.78) { score -= 2; findings.push(`density ${round1(s.contentDensity)} is cramped`); }
    else if (s.contentDensity < 0.08) { score -= 1; findings.push(`density ${round1(s.contentDensity)} feels empty`); }
  }
  if (s.oversizedEmptyHero) { score -= 1; findings.push('oversized empty hero region'); }
  return { score: clamp(score), findings };
}

function scoreMotion(s) {
  const findings = [];
  const timing = gradeMotionTiming({ durationMs: s.primaryTransitionMs, easing: s.primaryEasing });
  let score = timing.score;
  findings.push(`timing: ${timing.reason}`);
  // Layout shift during an interaction is the opposite of "expensive/intentional".
  if (s.layoutShiftPx != null) {
    if (s.layoutShiftPx > 8) { score -= 3; findings.push(`content jumped ${s.layoutShiftPx}px during interaction`); }
    else if (s.layoutShiftPx > 2) { score -= 1; findings.push(`minor ${s.layoutShiftPx}px shift`); }
    else findings.push('no measurable layout shift');
  }
  return { score: clamp(score), findings };
}

function scoreInteractionFeel(s) {
  const findings = [];
  let score = 5;
  // Input latency: keypress → value reflected. <60ms feels alive; >180ms feels laggy.
  if (s.inputLatencyMs != null) {
    if (s.inputLatencyMs < 60) { score += 2; findings.push(`${s.inputLatencyMs}ms input latency → alive`); }
    else if (s.inputLatencyMs > 180) { score -= 2; findings.push(`${s.inputLatencyMs}ms input latency → laggy`); }
    else findings.push(`${s.inputLatencyMs}ms input latency`);
  }
  // Focus ring: present and visible = keyboard-respectful; absent = a11y + feel flaw.
  if (s.focusRingVisible === true) { score += 2; findings.push('visible focus ring'); }
  else if (s.focusRingVisible === false) { score -= 2; findings.push('no visible focus ring'); }
  // Hover affordance: a measurable style delta on hover = "feels clickable".
  if (s.hoverStateDelta === true) { score += 1; findings.push('hover changes style (feels clickable)'); }
  else if (s.hoverStateDelta === false) { score -= 1; findings.push('no hover affordance'); }
  return { score: clamp(score), findings };
}

function scoreVisualIdentity(s) {
  const findings = [];
  let score = 5;
  const generic = detectGenericAesthetic(s);
  if (generic.length) { score -= Math.min(3, generic.length); findings.push(`generic-AI signals: ${generic.join(', ')}`); }
  else findings.push('no generic-AI aesthetic signals detected');
  // Color intelligence: a small intentional palette (4..14 distinct) beats chaos.
  if (s.distinctColors != null) {
    if (s.distinctColors >= 3 && s.distinctColors <= 16) { score += 1; findings.push(`${s.distinctColors}-color palette is disciplined`); }
    else if (s.distinctColors > 24) { score -= 1; findings.push(`${s.distinctColors} colors → undisciplined palette`); }
  }
  // Typography quality: a real custom/font-stack (not just default sans) + a scale.
  if (s.usesCustomFont === true) { score += 1; findings.push('custom typeface in use'); }
  return { score: clamp(score), findings, genericFlags: generic };
}

function scoreEmotionalQuality(comp, motion, feel, identity) {
  // Emotion is DERIVED, not asserted: calm = low density + low shift; confidence = hierarchy +
  // focus discipline; delight = good motion + no generic slop. We never claim delight the
  // signals don't support.
  const findings = [];
  const calm = (comp.score + motion.score) / 2;
  const confidence = (comp.score + feel.score) / 2;
  const delight = (motion.score + identity.score) / 2;
  const score = clamp((calm + confidence + delight) / 3);
  findings.push(`calm≈${round1(calm)}, confidence≈${round1(confidence)}, delight≈${round1(delight)} (derived)`);
  return { score: round1(score), findings };
}

/**
 * Human-appeal prediction — the compact judgment the owner asked for. Each axis maps to
 * measured rubric scores, NOT a freeform guess.
 */
function predictHumanAppeal(scores, identity, flaws) {
  const blockers = flaws.filter((f) => f.severity === 'P0').length;
  const obvious = flaws.filter((f) => f.severity === 'P1').length;
  const firstImpression = clamp(round1((scores.composition + scores.visualIdentity) / 2 - blockers * 2));
  const modernPremium = clamp(round1(scores.visualIdentity - (identity.genericFlags.length ? 1 : 0)));
  const interaction = clamp(round1((scores.interactionFeel + scores.motion) / 2 - blockers));
  const trustClarity = clamp(round1(scores.composition - obvious * 0.5 - blockers * 2));
  // Wow is hardest to earn and easiest to fake — gate it hard on no blockers + real motion/identity.
  const wow = clamp(round1(
    blockers ? 1 : (scores.motion + scores.visualIdentity) / 2 - (identity.genericFlags.length ? 2 : 0),
  ));
  const keepUsing = clamp(round1((scores.interactionFeel + scores.composition + (10 - blockers * 3)) / 3));

  const likeReason = identity.genericFlags.length
    ? 'clean enough to function'
    : scores.visualIdentity >= 7 ? 'disciplined palette + distinct identity' : 'readable and orderly';
  const dislikeReason = blockers
    ? 'a P0 flaw blocks or hides content'
    : identity.genericFlags.length ? `feels template/AI-generated (${identity.genericFlags[0]})`
      : scores.motion <= 4 ? 'motion feels cheap or jarring'
        : 'polish gaps keep it from premium';

  return {
    firstImpression, modernPremium, interaction, trustClarity, wow, keepUsing,
    likeReason, dislikeReason,
  };
}

/** Build flaw findings from measured signals, with severity + cause + fix direction. */
export function buildFlaws(signals) {
  const s = signals || {};
  const flaws = [];
  const seen = new Set();
  const add = (severity, symptom, evidence, likelyCause, userImpact, fixDirection) => {
    // De-dupe by symptom+selector so 9 identical spans collapse to one actionable finding
    // (with a count) instead of flooding the council with repeats.
    const key = `${symptom}|${evidence?.selector ?? ''}`;
    const prior = seen.has(key) ? flaws.find((f) => `${f.symptom}|${f.evidence?.selector ?? ''}` === key) : null;
    if (prior) { prior.occurrences = (prior.occurrences ?? 1) + 1; return; }
    seen.add(key);
    flaws.push({ severity, symptom, evidence, likelyCause, userImpact, fixDirection, occurrences: 1 });
  };

  for (const c of s.clippedPopovers || []) {
    add('P0', 'popover/menu clipped by an ancestor',
      { selector: c.selector, clippedBy: c.clipperSelector, viewport: s.viewport },
      `ancestor has overflow:${c.clipperOverflow || 'hidden'} and the popover is not portaled to the top layer`,
      'a human cannot see or click some menu options',
      'render the popover in a portal / top-layer, or remove clipping from the ancestor');
  }
  for (const o of s.offscreenInteractive || []) {
    add('P0', 'interactive element opens partly/fully offscreen',
      { selector: o.selector, box: o.box, viewport: s.viewport },
      'fixed/absolute position not clamped to the viewport',
      'a human cannot reach the control',
      'clamp/flip the position so it stays within the viewport');
  }
  for (const c of s.coveredInteractive || []) {
    add('P0', 'interactive element is covered by another element',
      { selector: c.selector, topLabel: c.topLabel, point: c.point, viewport: s.viewport },
      'stacking context or z-index places another element over the control',
      'a human sees the control but the click lands somewhere else',
      'fix stacking order, remove the covering layer, or move the control into the top layer');
  }
  for (const t of s.tinyClickTargets || []) {
    add('P2', 'click target is too small for comfortable use',
      { selector: t.selector, box: t.box, viewport: s.viewport },
      'control hit area is below the comfortable 32px minimum',
      'the UI feels fiddly, especially on touch or high-DPI screens',
      'increase padding/hit area while keeping visual alignment intact');
  }
  for (const t of s.invisibleText || []) {
    add(t.contrast < 1.6 ? 'P0' : 'P1', 'low-contrast / near-invisible text',
      { selector: t.selector, contrast: round1(t.contrast), fg: t.fg, bg: t.bg },
      'text color is too close to its background (or layered over a same-tone surface)',
      'a human struggles or fails to read the text',
      'raise contrast to ≥4.5:1 for body text (≥3:1 for large text)');
  }
  if (s.unexpectedScrollbar) {
    add('P2', 'unexpected scrollbar appeared',
      { axis: s.unexpectedScrollbar, viewport: s.viewport },
      'a child overflows its container by a few px (often padding/border-box math)',
      'the layout feels unfinished and can jump',
      'fix the box-model overflow; use box-sizing/min-width:0 on flex children');
  }
  if (s.layoutShiftPx != null && s.layoutShiftPx > 8) {
    add('P1', 'content jumps during interaction',
      { shiftPx: s.layoutShiftPx, viewport: s.viewport },
      'late-loading content or an animated size change reflows siblings',
      'humans perceive the UI as janky/cheap',
      'reserve space ahead of time, or animate transform/opacity instead of layout');
  }
  if (s.focusRingVisible === false) {
    add('P1', 'no visible keyboard focus state',
      { measured: 'getComputedStyle(:focus) outline/box-shadow unchanged' },
      'outline:none without a replacement focus style',
      'keyboard users lose their place; fails a11y expectations',
      'add a visible focus-visible ring (outline or box-shadow)');
  }
  if (s.hoverStateDelta === false) {
    add('P3', 'primary button lacks a hover affordance',
      { measured: 'no computed-style delta on hover' },
      'no :hover rule for the control',
      'the control does not feel clickable',
      'add a subtle hover state (background/elevation/scale)');
  }
  return flaws;
}

/**
 * The full evidence-bound verdict. `signals` is what the probe measured; everything here
 * is derived from it. Returns rubric scores, flaws, human-appeal prediction, and a taste
 * lesson — all inspectable.
 */
export function judgeVisualExcellence(signals) {
  const s = signals || {};
  const comp = scoreComposition(s);
  const motion = scoreMotion(s);
  const feel = scoreInteractionFeel(s);
  const identity = scoreVisualIdentity(s);
  const emotion = scoreEmotionalQuality(comp, motion, feel, identity);

  const scores = {
    composition: comp.score,
    motion: motion.score,
    interactionFeel: feel.score,
    visualIdentity: identity.score,
    emotionalQuality: emotion.score,
  };
  const flaws = buildFlaws(s);
  const humanAppeal = predictHumanAppeal(scores, identity, flaws);

  const overall = round1(
    (scores.composition + scores.motion + scores.interactionFeel + scores.visualIdentity + scores.emotionalQuality) / 5,
  );

  // Taste lesson: a reusable, signal-grounded sentence Vai can carry forward.
  const tasteLesson = buildTasteLesson({ scores, identity, flaws, motion });

  return {
    overall,
    scores,
    findings: {
      composition: comp.findings,
      motion: motion.findings,
      interactionFeel: feel.findings,
      visualIdentity: identity.findings,
      emotionalQuality: emotion.findings,
    },
    genericFlags: identity.genericFlags,
    flaws,
    flawCounts: countSeverities(flaws),
    humanAppeal,
    tasteLesson,
    headline: buildHeadline(overall, scores, flaws, humanAppeal),
  };
}

function countSeverities(flaws) {
  const c = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of flaws) if (c[f.severity] != null) c[f.severity] += 1;
  return c;
}

function buildTasteLesson({ scores, identity, flaws, motion }) {
  const p0 = flaws.find((f) => f.severity === 'P0');
  if (p0) return `A UI that hides or blocks content (${p0.symptom}) is broken before it can be beautiful — fix top-layer/contrast before polish.`;
  if (identity.genericFlags.length) return `Avoid ${identity.genericFlags[0]}: effects must serve state/meaning, not decorate. Distinctiveness beats a familiar AI look.`;
  if (motion.score <= 4) return 'Motion should explain state with eased 150–450ms transitions; linear/instant or layout-shifting motion reads cheap.';
  if (scores.composition >= 7 && scores.visualIdentity >= 7) return 'Hierarchy + a disciplined palette earned this — keep the type scale tight and the palette small.';
  return 'Functional is the floor, not the goal: pursue a real type scale, intentional motion, and a distinct identity.';
}

function buildHeadline(overall, scores, flaws, ha) {
  const counts = countSeverities(flaws);
  const flawStr = flaws.length ? `${counts.P0}×P0 ${counts.P1}×P1 ${counts.P2}×P2 ${counts.P3}×P3` : 'no flaws';
  return `visual ${overall}/10 · comp ${scores.composition} motion ${scores.motion} feel ${scores.interactionFeel} identity ${scores.visualIdentity} · wow ${ha.wow}/10 · ${flawStr}`;
}
