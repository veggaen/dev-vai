/**
 * capability-lenses — generative framings for the Capability-Innovation council.
 *
 * personas.mjs asks "what LINE is wrong?" (corrective). These lenses ask the twin
 * generative question: "what FEATURE would make Vai measurably more capable,
 * trustworthy, and faithful to the north-star?" Each lens is a world-class expert
 * pointed at the SAME grounded codebase (via the tool loop) but weighting a
 * different axis of the mission — voice, vision, tool-chaining, council process,
 * reliability, delegation. Diversity of framing is the point: different experts
 * surface different capability gaps, and agreement between them is the strongest
 * signal that an upgrade is real and not one model's fantasy.
 *
 * Pure framings only — the real grounding is the tool loop in capability-engine.mjs.
 * Lenses just steer WHAT the council hunts for and HOW it weighs a proposal.
 */

export const LENSES = [
  {
    id: 'tool-use-architect',
    area: 'tooling',
    title: 'a tool-use architect who makes the model ACT, not just answer',
    lens:
      'Hunt for the gap between "Vai can describe a task" and "Vai can DO it". Find where a real tool ' +
      '(file, web, shell, API, code-run) would let Vai complete a task end-to-end. Propose the smallest ' +
      'new tool or the wiring that lets an existing tool be CALLED in the real chat path, not just the loop.',
  },
  {
    id: 'multimodal-voice',
    area: 'voice',
    title: 'a voice-interface engineer building the speak-to-Vai north-star',
    lens:
      'The locked mission is voice + interface: V3gga SPEAKS to Vai and gets help with any task. Find the ' +
      'nearest honest slice toward a spoken turn (STT in, TTS out, barge-in, streaming). Ground it in the ' +
      'existing chat/runtime path so it is a real wiring, not a greenfield rewrite.',
  },
  {
    id: 'vision-image',
    area: 'vision',
    title: 'a multimodal engineer adding eyes (images in, images out)',
    lens:
      'Find where Vai is blind: a task that needs SEEING (a screenshot, a diagram, a rendered page) or ' +
      'SHOWING (a generated image, an annotated capture). Propose the smallest path to image input or ' +
      'output that plugs into the current message/preview pipeline.',
  },
  {
    id: 'council-process-improver',
    area: 'council',
    title: 'a deliberation designer who makes the roundtable actually converge',
    lens:
      'Treat the council ITSELF as the product. Using the council-rubric dimensions (synthesis, convergence, ' +
      'chaining, delegation, grounding, actionability), find the weakest part of how the roundtable runs and ' +
      'propose a concrete process upgrade: more lenses, a convergence vote, a synthesis step, a debate round.',
  },
  {
    id: 'reliability-no-lost-details',
    area: 'reliability',
    title: 'a reliability engineer who refuses to let details get lost',
    lens:
      'V3gga\'s bar: complete tasks WITHOUT mistakes or lost details. Find where context, a requirement, or a ' +
      'sub-step silently gets dropped between turns/agents. Propose a verification or memory mechanism that ' +
      'makes "did we actually do everything asked?" a measured check, not a hope.',
  },
  {
    id: 'delegation-orchestrator',
    area: 'delegation',
    title: 'an orchestration architect who delegates execution to the right worker',
    lens:
      'Vai is the institution; models are staff. Find where one model is doing a job a specialised worker ' +
      '(or a chain of workers) should own. Propose a delegation/routing upgrade: who decides, who executes, ' +
      'who verifies — and how the hand-off carries full context so nothing is re-derived or lost.',
  },
  {
    id: 'capability-gap-hunter',
    area: 'capability-gap',
    title: 'a product strategist hunting the highest-leverage missing capability',
    lens:
      'Step back to the whole mission. Compare what V3gga keeps asking for (the message history / backlog) ' +
      'against what Vai can do today. Name the ONE missing capability whose absence blocks the most tasks, ' +
      'and the smallest first slice that would unblock it.',
  },
];

/** Map a free-text focus/area hint to the most relevant lens ids, so a round can be
 *  themed (e.g. "voice") without losing the always-on core (gap hunter + council). */
const FOCUS_MAP = [
  [/voice|speak|audio|speech/i, ['multimodal-voice']],
  [/image|vision|screenshot|see|visual/i, ['vision-image']],
  [/tool|chain|act|execute|api|shell/i, ['tool-use-architect']],
  [/council|roundtable|debate|converge|synthes/i, ['council-process-improver']],
  [/reliab|detail|lost|memory|trust|verify/i, ['reliability-no-lost-details']],
  [/delegat|orchestrat|route|worker|agent/i, ['delegation-orchestrator']],
];

/** Always-on lenses: the gap hunter keeps the round honest about the WHOLE mission,
 *  and the council-process improver keeps "improve the roundtable" on every agenda. */
const CORE_LENS_IDS = ['capability-gap-hunter', 'council-process-improver'];

/**
 * Pick the lenses for a round. With no focus, returns ALL lenses (a full roundtable).
 * With a focus string, returns the core lenses plus the focus-matched ones, so a
 * themed round stays grounded in the mission instead of tunnel-visioning.
 */
export function selectLenses(focus = '', { extra = [] } = {}) {
  if (!focus && !extra.length) return LENSES.slice();
  const want = new Set([...CORE_LENS_IDS, ...extra]);
  for (const [re, ids] of FOCUS_MAP) if (re.test(focus)) ids.forEach((id) => want.add(id));
  const picked = LENSES.filter((l) => want.has(l.id));
  return picked.length ? picked : LENSES.slice();
}

/** Build the lens-specific system preamble appended to the grounded capability agent. */
export function lensPreamble(lens, { goal, focus } = {}) {
  return (
    `You are ${lens.title}.\n` +
    `Investigate the dev-vai codebase through that lens:\n${lens.lens}\n\n` +
    `Perpetual goal (north-star): ${goal ?? 'make Vai more capable, trustworthy, and faithful to the voice+interface mission'}.\n` +
    (focus ? `This round's focus: ${focus}.\n` : '') +
    `Stay grounded: only cite a file/line you actually read via the tools. Propose ONE feature-level ` +
    `upgrade in area "${lens.area}" — the smallest first slice that moves the goal, with a way to verify it.`
  );
}
