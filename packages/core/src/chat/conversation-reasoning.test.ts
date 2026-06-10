import { describe, expect, it } from 'vitest';
import { tryEmitConversationReasoning } from './conversation-reasoning.js';
import type { FactsHistoryMessage } from './conversation-facts.js';

function user(content: string): FactsHistoryMessage {
  return { role: 'user', content };
}

function assistant(content: string): FactsHistoryMessage {
  return { role: 'assistant', content };
}

function reason(content: string, history: FactsHistoryMessage[] = [user(content)]) {
  return tryEmitConversationReasoning({ content, history });
}

describe('tryEmitConversationReasoning', () => {
  it('derives exposure guidance from arbitrary loopback and wildcard hosts', () => {
    const reply = reason('Control A: bind to ::1. In two bullets, state the safe default and risk if changed to ::.')?.reply;
    expect(reply).toContain('::1');
    expect(reply).toContain('::');
    expect(reply).toMatch(/loopback/i);
    expect(reply).toMatch(/network/i);
  });

  it('blocks wildcard startup when a credential is empty and serializes arbitrary requested keys', () => {
    const history = [
      user('Change the bind host to 0.0.0.0 and the auth token is empty. Should startup continue?'),
      assistant('No. Block startup until authentication exists.'),
      user('Compress that decision into JSON only. Use exactly these keys: can_proceed, blocking_reason, remediation.'),
    ];
    const reply = reason(history[2].content, history)?.reply ?? '';
    expect(JSON.parse(reply)).toEqual({
      can_proceed: false,
      blocking_reason: expect.stringMatching(/0\.0\.0\.0.*auth token/i),
      remediation: expect.stringMatching(/loopback|non-empty/i),
    });
  });

  it('reviews sibling-prefix containment for POSIX paths using path.relative', () => {
    const reply = reason(
      "Review const full = path.resolve(rootDir, requested); if (!full.startsWith(rootDir)) throw Error('blocked'); rootDir is /srv/jobs. Show how /srv/jobs-cache/settings.json defeats the prefix test.",
    )?.reply;
    expect(reply).toMatch(/sibling-prefix/i);
    expect(reply).toContain('/srv/jobs-cache/settings.json');
    expect(reply).toContain('path.relative');
  });

  it('acknowledges and applies the latest language constraint after a correction', () => {
    const history = [
      user('Every code answer must use Python only. Acknowledge the rule.'),
      assistant('Understood.'),
      user('Correction: every code answer must now use Rust only, replacing Python. Confirm the rule.'),
      assistant('Understood.'),
      user('Write a helper that reads an environment string and returns a positive integer or an error.'),
    ];
    const reply = reason(history[4].content, history)?.reply ?? '';
    expect(reply).toMatch(/^```rust/);
    expect(reply).toContain('parse::<u64>');
    expect(reply).not.toMatch(/```python/);
  });

  it('recalls the latest committed decision and its alternate role dynamically', () => {
    const history = [
      user('Decision: use local disk for production; S3 remains only for migration evaluation. Acknowledge the committed choice.'),
      assistant('Noted.'),
      user('Correction: use S3 for production instead; local disk remains only for test snapshots. Acknowledge this correction.'),
      assistant('Noted.'),
      user('Recall which option we committed to for production and the limited role for the alternative.'),
    ];
    const reply = reason(history[4].content, history)?.reply ?? '';
    expect(reply).toContain('**S3**');
    expect(reply).toContain('**local disk**');
    expect(reply).toMatch(/test snapshots/i);
  });

  it('does not absorb an operator prefix into an anchored production decision', () => {
    const reply = reason(
      'Use an operational answer. Project note X. Decision: use local disk for production; S3 remains only for migration evaluation. Acknowledge the committed choice.',
    )?.reply ?? '';
    expect(reply).toContain('**local disk**');
    expect(reply).not.toMatch(/\*\*an operational answer/i);
  });

  it('does not absorb the remains verb into a canonical alternate choice', () => {
    const reply = reason(
      'Decision: use Postgres for production; SQLite remains only for local fixtures. Acknowledge the committed choice.',
    )?.reply ?? '';
    expect(reply).toContain('**SQLite** remains only');
    expect(reply).not.toMatch(/remains\*\* remains/i);
  });

  it('explains DNS rebinding as a reusable SSRF defense concept', () => {
    const reply = reason('Briefly explain why DNS rebinding matters for SSRF defenses. No code yet.')?.reply ?? '';
    expect(reply).toMatch(/dns rebinding/i);
    expect(reply).toMatch(/hostname|resolution/i);
    expect(reply).toMatch(/private internal ip/i);
  });

  it('asks one high-information incident question and produces a queue diagnosis after evidence', () => {
    const first = reason('Production incident: after deploy, queue depth is rising and worker CPU is low. Ask exactly one highest-information clarifying question and stop.')?.reply ?? '';
    expect((first.match(/\?/g) ?? []).length).toBe(1);
    expect(first).toMatch(/queue backlog|consumer group/i);

    const second = reason('The backlog began with the new worker version and disappeared after rollback. Give a ranked diagnosis and the first three verification steps.')?.reply ?? '';
    expect(second).toMatch(/worker|consumer/i);
    expect(second).toMatch(/queue/i);
    expect(second).toMatch(/rollback/i);
    expect(second).toMatch(/trace/i);
  });

  it('turns arbitrary audit counts into cluster-first prioritization and follow-up thresholds', () => {
    const audit = 'Engineering audit: the repo has 91 lint failures across 14 files, 36 root scratch artifacts, 6 authored modules above 5,000 lines, and 173 runtime routes.';
    const first = reason(audit)?.reply ?? '';
    expect(first).toMatch(/91 lint failures/i);
    expect(first).toMatch(/36 root scratch artifacts/i);
    expect(first).toMatch(/173 runtime routes/i);
    expect(first).toMatch(/cluster baseline/i);

    const history = [user(audit), assistant(first), user('Give one threshold that should trigger architectural escalation.')];
    const followUp = reason(history[2].content, history)?.reply ?? '';
    expect(followUp).toMatch(/trigger architectural escalation/i);
    expect(followUp).toMatch(/third local patch|5,000 lines/i);
  });

  it('accepts casual lowercase language rules and applies a later conversational correction', () => {
    const history = [
      user('if i ask for snippets later, pls keep the code in Python. say you got it.'),
      assistant('Got it.'),
      user('small revision: use Go for code from here on, not Python. confirm.'),
      assistant('Confirmed.'),
      user('could you make a validator that converts text to a positive whole number and errors below one?'),
    ];
    const reply = reason(history[4].content, history)?.reply ?? '';
    expect(reply).toMatch(/^```go/);
    expect(reply).toContain('parsePositiveInteger');
  });

  it('combines a concept answer with a durable code-rule acknowledgement', () => {
    const reply = reason('i need two things: explain idempotency briefly, and remember future code snippets should be Rust. acknowledge both.')?.reply ?? '';
    expect(reply).toMatch(/repeating the same operation/i);
    expect(reply).toMatch(/code answer in Rust/i);
  });

  it('understands colloquial exposure review, unavailable credentials, and field-based JSON contracts', () => {
    const history = [
      user('It listens on 127.0.0.1. Ops wants 0.0.0.0. Compare local safety with the wider exposure.'),
      assistant('Loopback is safer.'),
      user('The auth token was not configured. Can we bring it up on 0.0.0.0?'),
      assistant('No.'),
      user('Repeat that as a bare JSON object. Fields are may_start, blocker, remedy.'),
    ];
    const payload = JSON.parse(reason(history[4].content, history)?.reply ?? '');
    expect(payload).toEqual({
      may_start: false,
      blocker: expect.stringMatching(/0\.0\.0\.0.*auth token/i),
      remedy: expect.stringMatching(/loopback|non-empty/i),
    });
  });

  it('recalls a naturally phrased corrected production decision', () => {
    const history = [
      user('Lets ship SQLite in prod. Keep Postgres around only while we evaluate the migration. Confirm where we landed.'),
      assistant('Confirmed.'),
      user('Actually reverse that. Prod should run on Postgres; SQLite is just for local fixtures. Confirm the new landing point.'),
      assistant('Confirmed.'),
      user('Where did we land for prod, and what is the old options only remaining job?'),
    ];
    const reply = reason(history[4].content, history)?.reply ?? '';
    expect(reply).toContain('**Postgres**');
    expect(reply).toContain('**SQLite**');
    expect(reply).toMatch(/local fixtures/i);
  });

  it('handles casual incident calibration and reordered systems inventories', () => {
    const incident = reason('After rollout the backlog grows and worker CPU stays low. Before diagnosing, ask the single question that cuts uncertainty most.')?.reply ?? '';
    expect((incident.match(/\?/g) ?? []).length).toBe(1);
    expect(incident).toMatch(/queue backlog|consumer group/i);

    const inventory = reason('Routes=152; root has 41 scratch files; 63 lint issues touch 19 files; and 4 authored files are over 5000 LOC. Prioritize shared causes.')?.reply ?? '';
    expect(inventory).toMatch(/63 lint failures/i);
    expect(inventory).toMatch(/41 root scratch artifacts/i);
    expect(inventory).toMatch(/152 runtime routes/i);
  });

  it('handles paraphrased path questions and a one-character concept typo', () => {
    const pathReply = reason("rootDir = /srv/jobs-44. const full = path.resolve(rootDir, requested); if (!full.startsWith(rootDir)) throw Error('blocked'). Can /srv/jobs-44-cache/settings.json slip through?")?.reply ?? '';
    expect(pathReply).toContain('/srv/jobs-44-cache/settings.json');
    expect(pathReply).toContain('path.relative');

    const followUp = reason('Does normalizing with path.resolve by itself mean the result stayed below the root?')?.reply ?? '';
    expect(followUp).toMatch(/^No\./);

    const dns = reason('Whats DNS rebindng, and why can an SSRF check miss it?')?.reply ?? '';
    expect(dns).toMatch(/hostname.*private internal IP/i);
  });

  it('reviews natural startsWith containment questions without requiring path.resolve wording', () => {
    const reply = reason(
      'can you audit this node path check? root is /srv/uploads-12 and it only checks full.startsWith(root). could /srv/uploads-12-old/config.json still get through, and what should i use instead?',
    )?.reply ?? '';
    expect(reply).toContain('/srv/uploads-12-old/config.json');
    expect(reply).toContain('path.relative');
  });

  it('prioritizes partial conversational audit inventories without inventing missing metrics', () => {
    const reply = reason(
      'okay so we have 30 scratch files in root, 8 files over 5000 lines and 65 lint errors. can you look at this like an engineering auditor and tell me the shared causes first?',
    )?.reply ?? '';
    expect(reply).toMatch(/30 root scratch artifacts/i);
    expect(reply).toMatch(/8 oversized modules/i);
    expect(reply).toMatch(/65 lint failures/i);
    expect(reply).not.toMatch(/runtime routes/i);
  });

  it('answers natural concept follow-ups with practical project detail', () => {
    const reply = reason('okay but tell me more about back pressure in a worker queue, like when would this actually matter in a real project?')?.reply ?? '';
    expect(reply).toMatch(/producer|consumer/i);
    expect(reply).toMatch(/real project/i);
    expect(reply.length).toBeGreaterThan(100);
  });

  it('asks a clarifying question for a vague project-help request', () => {
    const reply = reason('i need help with my vite app project but im not really sure where to start')?.reply ?? '';
    expect(reply).toMatch(/\?$/);
    expect(reply).toMatch(/concrete problem|blank screen|error/i);
  });

  it('computes conversational arithmetic output contracts in words', () => {
    expect(reason('okay then what is 18 plus 11 minus one? reply only with the answer written in letters, dont use numbers')?.reply).toBe('twenty-eight');
    expect(reason('what is 10+10? answer in words only')?.reply).toBe('twenty');
  });

  it('recognizes the adjective form idempotent inside a natural detour', () => {
    const reply = reason('quick detour before we go back to Quartz, what does idempotent mean?')?.reply ?? '';
    expect(reply).toMatch(/repeating the same operation/i);
  });

  it('acknowledges arbitrary project names and stacks through the shared fact extractor', () => {
    const reply = reason('okay remember this for later, project Quartz uses Python and Redis. i will ask about it again')?.reply ?? '';
    expect(reply).toContain('**Quartz**');
    expect(reply).toContain('Python');
    expect(reply).toContain('Redis');
  });

  it('gives category-driven diagnostics for imports, blank screens, and upload limits', () => {
    expect(reason('how do i make a typescript node cli? and what should i check if it cant find my imports?')?.reply).toMatch(/tsconfig\.json.*module/i);
    expect(reason('its a vite app. the screen stays blank after i moved the router setup. what would you check first?')?.reply).toMatch(/console.*router provider/i);
    expect(reason('how do i set up a raect app with tialwind? and what should i check if vite just shows a blank page?')?.reply).toMatch(/React \+ Tailwind \+ Vite/i);
    expect(reason('how do i set up a fasapi backend with a svetle frontend? and where should cors be configured?')?.reply).toMatch(/FastAPI \+ Svelte.*CORS/i);
    expect(reason('its a small api. the upload endpoint should reject large files before they fill memory. what would you check first?')?.reply).toMatch(/upload-size limit.*streaming multipart/i);
  });

  it('emits a reusable playable single-page game preview and explains its controls on follow-up', () => {
    const first = reason('can you show me a single page html example of a small maze game so i can play it in the preview?')?.reply ?? '';
    expect(first).toMatch(/```html/);
    expect(first).toMatch(/canvas/i);
    expect(first).toMatch(/WASD|arrow keys/i);

    const history = [
      user('can you show me a single page html example of a small maze game so i can play it in the preview?'),
      assistant(first),
    ];
    const followUp = reason('emm so this small maze game should actually be playable in the preview right? make sure the controls are clear', history)?.reply ?? '';
    expect(followUp).toMatch(/WASD|arrow keys/i);
  });
});
