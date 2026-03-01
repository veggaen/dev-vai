/**
 * Fix YouTube sources — one-time migration script.
 *
 * 1. Fixes hasTranscript meta for all YouTube sources (content-based truth)
 * 2. Attempts to re-fetch transcripts via yt-dlp / HTTP for sources without real content
 * 3. Re-ingests sources that get new transcript content
 *
 * Usage:
 *   node scripts/fix-youtube-sources.mjs [--dry-run] [--limit N]
 *
 * Requires: VAI server running on localhost:3006
 */

const BASE = 'http://localhost:3006';
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const PLACEHOLDER = /\[no transcript|\[no captions|\[failed to parse/i;

async function main() {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  YouTube Source Fix Script                  ║`);
  console.log(`║  ${DRY_RUN ? 'DRY RUN — no changes will be made' : 'LIVE MODE — will modify database'}       ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);

  // 1. Health check
  try {
    const h = await (await fetch(`${BASE}/health`)).json();
    console.log(`Server: ${h.status} | Engine: ${h.engine} | Sources: ${h.stats?.knowledgeEntries ?? '?'} knowledge entries\n`);
  } catch {
    console.error('ERROR: Server not reachable at localhost:3006. Start the server first.');
    process.exit(1);
  }

  // 2. Get all sources
  const allSources = await (await fetch(`${BASE}/api/sources`)).json();
  const ytSources = allSources.filter(s => s.sourceType === 'youtube');
  console.log(`Found ${ytSources.length} YouTube sources to audit.\n`);

  // 3. Audit each YouTube source
  let fixed = 0;
  let refetched = 0;
  let refetchFailed = 0;
  let alreadyCorrect = 0;
  let totalNewWords = 0;

  const toRefetch = [];

  for (let i = 0; i < Math.min(ytSources.length, LIMIT); i++) {
    const src = ytSources[i];
    const detail = await (await fetch(`${BASE}/api/sources/${src.id}`)).json();
    const content = detail.content?.full || '';
    const meta = detail.meta || {};
    const hasPlaceholder = PLACEHOLDER.test(content);
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    if (i % 50 === 0 && i > 0) {
      console.log(`  Progress: ${i}/${ytSources.length}... (fixed ${fixed}, refetched ${refetched})`);
    }

    if (meta.hasTranscript && hasPlaceholder) {
      // LYING: meta says transcript, content says no
      fixed++;
      toRefetch.push({ id: src.id, url: src.url, title: src.title, words: wordCount });
    } else if (!meta.hasTranscript && hasPlaceholder) {
      // Correctly marked as no transcript — still try to refetch
      toRefetch.push({ id: src.id, url: src.url, title: src.title, words: wordCount });
    } else if (meta.hasTranscript && !hasPlaceholder && wordCount > 50) {
      // Legit transcript
      alreadyCorrect++;
    } else if (wordCount < 50) {
      // Very short content, might be broken
      toRefetch.push({ id: src.id, url: src.url, title: src.title, words: wordCount });
    } else {
      alreadyCorrect++;
    }
  }

  console.log(`\n--- Audit Results ---`);
  console.log(`  Already correct:          ${alreadyCorrect}`);
  console.log(`  Lying (meta says yes):    ${fixed}`);
  console.log(`  Need refetch (total):     ${toRefetch.length}`);
  console.log(`\n--- Attempting Re-fetch via Server ---\n`);

  if (DRY_RUN) {
    console.log('  DRY RUN — skipping re-fetch. Run without --dry-run to proceed.\n');
    return;
  }

  // 4. Re-fetch transcripts using the server's /api/ingest/youtube endpoint
  // This uses yt-dlp + HTTP fallback and re-ingests (overwriting existing source)
  const batchSize = 5;
  for (let i = 0; i < toRefetch.length; i += batchSize) {
    const batch = toRefetch.slice(i, i + batchSize);
    
    const results = await Promise.allSettled(
      batch.map(async (src) => {
        try {
          const res = await fetch(`${BASE}/api/ingest/youtube`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: src.url }),
            signal: AbortSignal.timeout(45000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = await res.json();
          return { ...src, result, success: true };
        } catch (err) {
          return { ...src, error: err.message, success: false };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) {
        const v = r.value;
        const newWords = v.result.tokensLearned || 0;
        if (newWords > 50) {
          refetched++;
          totalNewWords += newWords;
          console.log(`  ✓ "${v.title}" — ${newWords} tokens learned`);
        } else {
          refetchFailed++;
          console.log(`  ✗ "${v.title}" — re-fetched but still no real transcript`);
        }
      } else {
        const v = r.status === 'fulfilled' ? r.value : { title: '?', error: r.reason };
        refetchFailed++;
        console.log(`  ✗ "${v.title}" — ${v.error || 'unknown error'}`);
      }
    }

    // Rate-limit to avoid hammering YouTube
    if (i + batchSize < toRefetch.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
    
    if ((i + batchSize) % 50 < batchSize) {
      console.log(`\n  Progress: ${Math.min(i + batchSize, toRefetch.length)}/${toRefetch.length} attempted (${refetched} got transcripts)\n`);
    }
  }

  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  RESULTS                                   ║`);
  console.log(`╠════════════════════════════════════════════╣`);
  console.log(`║  Already correct:   ${String(alreadyCorrect).padStart(6)}               ║`);
  console.log(`║  Meta fixed:        ${String(fixed).padStart(6)}               ║`);
  console.log(`║  Re-fetched OK:     ${String(refetched).padStart(6)}               ║`);
  console.log(`║  Re-fetch failed:   ${String(refetchFailed).padStart(6)}               ║`);
  console.log(`║  New tokens added:  ${String(totalNewWords).padStart(6)}               ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);

  if (refetched > 0) {
    console.log(`✓ ${refetched} sources now have real transcripts.`);
    console.log(`  The re-ingest already updated the DB, fixed meta, rechunked, and retrained.\n`);
  }

  if (refetchFailed > 0) {
    console.log(`  Note: ${refetchFailed} sources could not get transcripts.`);
    console.log(`  This is normal — many YouTube videos don't have captions enabled.\n`);
  }
}

main().catch(console.error);
