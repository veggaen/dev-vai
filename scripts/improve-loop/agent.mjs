/**
 * agent — the grounded fix-proposer. Runs qwen in a tool-call loop so it sees
 * the REAL codebase before proposing, instead of hallucinating from one snippet.
 *
 * Loop: qwen emits a JSON tool call → harness executes it (grep/read/web) →
 * real result is appended to the transcript → qwen continues. After a few
 * evidence steps qwen emits a {"tool":"propose", ...} which ends the loop.
 *
 * This is the difference between "qwen guesses about a file it never saw" (it
 * fabricated an if-block last run) and "qwen greps for the function, reads the
 * actual lines, then patches the line it can quote".
 *
 * Still PROPOSE-only: the returned patch is graded + applied by the human gate.
 */
import { ollamaGenerate, waitForVramHeadroom } from './driver.mjs';
import { TOOL_SPEC, runTool } from './tools.mjs';

const MODEL = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b';

/** Pull the first JSON object out of a model reply. */
function parseToolCall(raw) {
  const m = raw.match(/\{[\s\S]*?\}(?=\s*$|\s*[^}])/) ?? raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Run the grounded proposal loop for one failure.
 * @returns {Promise<{proposal: object|null, transcript: string[]}>}
 */
export async function proposeGrounded({ klass, summary, fails, hintFile, maxSteps = 6, preamble = '' }) {
  const transcript = [];
  const sys =
`${preamble ? preamble + '\n\n' : ''}You are a senior engineer fixing a bug in the dev-vai TypeScript codebase.
You can INVESTIGATE the real code before proposing — do NOT guess about files you have not read.

${TOOL_SPEC}

Rules:
- Use grep_repo to FIND the relevant function, then read_file to READ the exact lines.
- Your "propose.find" MUST be a line you actually saw via read_file. If you did not read it, you may not patch it.
- Fix DECISION LOGIC (a regex / if / return), never a comment or log string.
- Emit exactly ONE tool call per reply, as strict JSON, no prose around it.

BUG CLASS: ${klass}
SYMPTOM: ${summary}
FAILING CASES:
${fails.map((f) => `- "${f.prompt}" → read as "${f.read_as ?? '?'}" → ${f.grade_reason}`).join('\n')}
${hintFile ? `HINT: a relevant file may be ${hintFile}` : ''}

Begin by locating the code. Your first reply must be a grep_repo or read_file call.`;

  let convo = sys;
  for (let step = 0; step < maxSteps; step++) {
    await waitForVramHeadroom(7 * 1024 ** 3);
    let raw;
    try { raw = await ollamaGenerate(MODEL, convo + '\n\nYour JSON tool call:', { numPredict: 300, timeoutMs: 120000 }); }
    catch (e) { transcript.push(`step ${step}: model error ${String(e)}`); break; }

    const call = parseToolCall(raw);
    if (!call || !call.tool) { transcript.push(`step ${step}: unparseable → "${raw.slice(0, 120)}"`); convo += `\n\n[harness] Reply was not a valid JSON tool call. Emit one JSON tool call.`; continue; }

    if (call.tool === 'propose') {
      transcript.push(`step ${step}: PROPOSE ${call.file} :: ${JSON.stringify(call.find ?? '').slice(0, 80)}`);
      // SELF-CRITIQUE GATE — the biggest quality lever. Before accepting, force qwen
      // to attack its own patch: name an input it would BREAK. This is what catches
      // the "|| text.includes('build')" class of plausible-but-wrong fix. qwen either
      // revises into a better patch or confirms it is safe with a concrete reason.
      const critiquePrompt =
        `${convo}\n\n[you proposed]\n${JSON.stringify(call)}\n\n` +
        `Now CRITIQUE your own patch like a harsh reviewer:\n` +
        `1. Name one concrete input that this "replace" would handle WRONG (a false positive or a broken existing case).\n` +
        `2. If such an input exists, your patch is unsafe — emit a REVISED {"tool":"propose",...} that fixes the class WITHOUT that breakage.\n` +
        `3. If you genuinely cannot find a breaking input, re-emit the SAME propose JSON and add "selfcheck":"<the case you tried and why it is safe>".\n` +
        `Reply with ONE JSON propose object only.`;
      let critRaw = '';
      try {
        await waitForVramHeadroom(7 * 1024 ** 3);
        critRaw = await ollamaGenerate(MODEL, critiquePrompt, { numPredict: 320, timeoutMs: 120000 });
      } catch { /* keep original on critique failure */ }
      const revised = parseToolCall(critRaw);
      if (revised && revised.tool === 'propose' && revised.find) {
        const changed = revised.find !== call.find || revised.replace !== call.replace;
        transcript.push(`step ${step}: SELF-CRITIQUE → ${changed ? 'REVISED' : 'held'}${revised.selfcheck ? ' (' + String(revised.selfcheck).slice(0, 60) + ')' : ''}`);
        return { proposal: revised, transcript, selfCritiqued: true, revised: changed };
      }
      return { proposal: call, transcript, selfCritiqued: false };
    }

    // Execute a real tool and feed the truth back.
    const result = await runTool(call);
    const shown = String(result).slice(0, 1400);
    transcript.push(`step ${step}: ${call.tool}(${JSON.stringify(call.pattern ?? call.path ?? call.query ?? '')}) → ${shown.split('\n').length} lines`);
    convo += `\n\n[you called] ${JSON.stringify(call)}\n[real result]\n${shown}\n\nContinue: emit the next JSON tool call (investigate more, or propose).`;
  }
  return { proposal: null, transcript };
}
