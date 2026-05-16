/**
 * Audit wrapper — monkey-patches VaiEngine.prototype.chat to record every
 * (prompt, full-history, response) tuple to a JSONL file, then dynamic-imports
 * the target bench file so it runs unchanged.
 *
 * Run via:
 *   CONV_AUDIT_PATH=... CONV_AUDIT_BENCH=... CONV_AUDIT_MODULE=./bench/<file>.mts \
 *     pnpm exec tsx ./bench/_audit-wrapper.mts -- <bench args>
 *
 * The trailing args are spliced into argv so the bench's own `--n=`/`--seed=`
 * parsing keeps working.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VaiEngine } from '../src/models/vai-engine.js';

const outPath = process.env.CONV_AUDIT_PATH;
const benchName = process.env.CONV_AUDIT_BENCH || 'unknown';
const benchModule = process.env.CONV_AUDIT_MODULE;

if (!outPath) { console.error('CONV_AUDIT_PATH not set'); process.exit(2); }
if (!benchModule) { console.error('CONV_AUDIT_MODULE not set'); process.exit(2); }

try { mkdirSync(dirname(outPath), { recursive: true }); } catch {}

const origChat = (VaiEngine.prototype as any).chat;
let callIdx = 0;
(VaiEngine.prototype as any).chat = async function patchedChat(req: any) {
  const myIdx = callIdx++;
  const t0 = Date.now();
  let resp: any = null;
  let errMsg: string | null = null;
  try {
    resp = await origChat.call(this, req);
    return resp;
  } catch (e: any) {
    errMsg = String(e?.message ?? e);
    throw e;
  } finally {
    try {
      const messages: any[] = Array.isArray(req?.messages) ? req.messages : [];
      const lastUser = [...messages].reverse().find((m: any) => m?.role === 'user');
      const responseText: string = (resp?.message?.content ?? resp?.content ?? '').toString();
      const strategy: string | null = (this as any)?._lastMeta?.strategy ?? null;
      const line = {
        bench: benchName,
        callIdx: myIdx,
        ts: t0,
        ms: Date.now() - t0,
        turnIdx: messages.filter((m: any) => m?.role === 'user').length - 1,
        prompt: lastUser?.content ?? '',
        response: responseText,
        strategy,
        history: messages.map((m: any) => ({ role: m?.role, content: m?.content })),
        sources: Array.isArray(resp?.sources) ? resp.sources.length : 0,
        followUps: Array.isArray(resp?.followUps) ? resp.followUps : null,
        confidence: resp?.confidence ?? null,
        error: errMsg,
      };
      appendFileSync(outPath, JSON.stringify(line) + '\n');
    } catch {
      // swallow logging errors
    }
  }
};

// Forward any post-`--` args to the bench's own argv parser.
const dashIdx = process.argv.indexOf('--');
if (dashIdx >= 0) {
  process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(dashIdx + 1)];
}

const absModule = resolve(process.cwd(), benchModule);
await import(pathToFileURL(absModule).href);
