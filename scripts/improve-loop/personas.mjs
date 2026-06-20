/**
 * Expert personas for grounded fix proposals.
 *
 * Running ONE prompt once gives one fallible 8B guess. Running the SAME grounded
 * investigation under several world-class expert framings, then keeping only the
 * patches that CONVERGE, turns a noisy local model into a consensus engine. Each
 * persona is context/goal/subject-aware: it is told the bug class, the failing
 * cases, and a distinct lens to reason from. Diversity of framing is the point —
 * different experts localize different bugs; agreement between them is signal.
 *
 * These are framings, not magic. The real grounding is the tool loop (agent.mjs);
 * personas just steer HOW qwen investigates and what it weights.
 */

export const PERSONAS = [
  {
    id: 'root-cause-surgeon',
    title: 'a root-cause debugger who distrusts symptoms',
    lens:
      'Trace the FAILING INPUT through the code path. Find the single line where the wrong branch was chosen. ' +
      'Ignore anything that only changes wording. The fix is the smallest change to that one deciding line.',
  },
  {
    id: 'control-flow-architect',
    title: 'a systems architect who thinks in guards and gates',
    lens:
      'Map the early-return guards and the order they fire. Bugs of this class are usually an over-broad guard ' +
      'firing before a more specific one. Find the guard that wrongly captures the failing input and tighten it ' +
      'WITHOUT loosening what it legitimately blocks.',
  },
  {
    id: 'regression-conservative',
    title: 'a senior engineer terrified of breaking existing tests',
    lens:
      'Assume there are tests pinning current behaviour. Propose the change that fixes the failing class while ' +
      'touching the FEWEST other inputs. Prefer adding a narrow condition over deleting an existing one. ' +
      'If a change would alter a clearly-correct existing case, reject it.',
  },
  {
    id: 'intent-semanticist',
    title: 'an NLP engineer focused on intent classification',
    discipline: 'ml',
    lens:
      'The bug is that the user INTENT was mapped to the wrong answer-shape. Find where intent is decided or where ' +
      'the answer template is selected. The fix routes this intent to the correct answer contract, not a definition dump.',
  },

  // ── Cross-disciplinary engineering panel ──────────────────────────────────
  // Different disciplines catch different bug classes. The council runs through
  // engineers of all sorts so no single blind spot dominates.
  {
    id: 'backend-engineer',
    title: 'a backend engineer who owns data flow and API contracts',
    discipline: 'backend',
    lens:
      'Follow the data: what shape goes in, what comes out, where the contract is violated. Bugs here are usually a ' +
      'transform that drops/mislabels a field, or a branch keyed on the wrong property. Fix the contract at the source.',
  },
  {
    id: 'frontend-engineer',
    title: 'a frontend engineer who owns rendering and component state',
    discipline: 'frontend',
    lens:
      'Think in render/state. Bugs here are stale state, a derived value computed wrong, or a prop/condition gating the ' +
      'wrong branch of UI. Find the component/selector that decides output and correct its condition, not the markup.',
  },
  {
    id: 'performance-engineer',
    title: 'a performance engineer obsessed with cost and latency',
    discipline: 'perf',
    lens:
      'Weigh the fix by cost. Prefer a change that removes redundant model calls, short-circuits earlier, or avoids ' +
      're-computation. Reject a fix that adds a slow path to handle a case a cheap guard could catch up front.',
  },
  {
    id: 'security-engineer',
    title: 'a security engineer who assumes inputs are hostile',
    discipline: 'security',
    lens:
      'Ask what a malicious or malformed input does to this branch. Bugs of interest: unvalidated input steering a ' +
      'privileged path, an injection surface, or a guard bypassable by phrasing. Fix by validating/normalising at the gate.',
  },
  {
    id: 'test-engineer',
    title: 'a test/QA engineer who thinks in cases and edge conditions',
    discipline: 'qa',
    lens:
      'Enumerate the input partitions: which class passes, which fails, which is the boundary. The fix must move the ' +
      'failing partition across the line WITHOUT moving a passing one. Name the edge case your change could break.',
  },
  {
    id: 'distributed-systems-engineer',
    title: 'a distributed-systems engineer who thinks in state, retries, and races',
    discipline: 'systems',
    lens:
      'Consider ordering, idempotency, and partial failure. Bugs here: a step that assumes a prior step succeeded, a ' +
      'race between async steps, or non-idempotent retry. Fix by making the deciding step robust to order/failure.',
  },
];

/** Pick a relevant subset of personas for a bug class so rounds are not wasted.
 *  Always includes the 4 core debugging lenses; adds disciplines that match the
 *  class keywords. Falls back to ALL personas when nothing matches. */
export function selectPersonas(klass = '', { extra = [] } = {}) {
  const core = PERSONAS.filter((p) => !p.discipline || p.discipline === 'ml');
  const k = klass.toLowerCase();
  const want = new Set(extra);
  if (/route|routing|intent|fresh|answer|compose|opportunit/.test(k)) { want.add('backend'); want.add('ml'); want.add('qa'); }
  if (/ui|render|timeline|component|frontend|css|panel/.test(k)) want.add('frontend');
  if (/latency|cost|perf|timeout|slow/.test(k)) want.add('perf');
  if (/auth|inject|escape|safety|security|sandbox/.test(k)) want.add('security');
  if (/council|race|async|retry|order|state|distributed/.test(k)) want.add('systems');
  const picked = PERSONAS.filter((p) => p.discipline && p.discipline !== 'ml' && want.has(p.discipline));
  const result = [...core, ...picked];
  return result.length >= core.length ? result : PERSONAS;
}

/** Build the persona-specific system preamble appended to the grounded agent. */
export function personaPreamble(persona, { klass, summary }) {
  return (
    `You are ${persona.title}.\n` +
    `Approach this specific bug with that lens:\n${persona.lens}\n\n` +
    `Stay grounded: only patch a line you have actually read via read_file. ` +
    `Subject: ${klass}. Goal: ${summary}`
  );
}
