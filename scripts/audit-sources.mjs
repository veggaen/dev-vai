/**
 * Audit YouTube sources: check how many actually have transcripts vs lying about it.
 * Also check web source word counts.
 */

const BASE = 'http://localhost:3006';

async function main() {
  // Get all sources
  const res = await fetch(`${BASE}/api/sources`);
  const allSources = await res.json();

  const ytSources = allSources.filter(s => s.sourceType === 'youtube');
  const webSources = allSources.filter(s => s.sourceType === 'web');

  console.log(`\n=== SOURCE AUDIT ===`);
  console.log(`Total: ${allSources.length} | YouTube: ${ytSources.length} | Web: ${webSources.length}\n`);

  // Audit YouTube sources
  let ytHasTranscript = 0;
  let ytNoTranscript = 0;
  let ytLying = 0; // claims hasTranscript but content is placeholder
  let ytMissingMeta = 0;
  let ytRealTranscripts = 0;
  let ytTotalWords = 0;
  const liars = [];

  console.log('Auditing YouTube sources...');
  for (let i = 0; i < ytSources.length; i++) {
    if (i % 50 === 0 && i > 0) process.stdout.write(`  ${i}/${ytSources.length}...\r`);
    
    const detail = await (await fetch(`${BASE}/api/sources/${ytSources[i].id}`)).json();
    const meta = detail.meta || {};
    const content = detail.content?.full || '';
    const words = content.split(/\s+/).filter(Boolean).length;
    ytTotalWords += words;

    const hasPlaceholder = /\[no transcript|\[no captions/i.test(content);
    
    if (meta.hasTranscript === undefined) {
      ytMissingMeta++;
    } else if (meta.hasTranscript) {
      ytHasTranscript++;
      if (hasPlaceholder) {
        ytLying++;
        liars.push({ id: ytSources[i].id, title: ytSources[i].title, words });
      } else {
        ytRealTranscripts++;
      }
    } else {
      ytNoTranscript++;
    }
  }

  console.log(`\n--- YouTube Audit ---`);
  console.log(`  Claims "Has Transcript":  ${ytHasTranscript}`);
  console.log(`  Actually has transcript:  ${ytRealTranscripts}`);
  console.log(`  LYING (green badge, no content): ${ytLying}`);
  console.log(`  Correctly "No Transcript":  ${ytNoTranscript}`);
  console.log(`  Missing meta:             ${ytMissingMeta}`);
  console.log(`  Total YouTube words:      ${ytTotalWords.toLocaleString()}`);
  console.log(`  Avg words/source:         ${Math.round(ytTotalWords / ytSources.length)}`);

  if (liars.length > 0) {
    console.log(`\n  First 10 liars:`);
    for (const l of liars.slice(0, 10)) {
      console.log(`    "${l.title}" — ${l.words} words`);
    }
  }

  // Audit Web sources (sample 50)
  let webTotalWords = 0;
  let webUnder50 = 0;
  let webUnder100 = 0;
  const sampleSize = Math.min(50, webSources.length);
  
  console.log(`\nAuditing Web sources (sampling ${sampleSize})...`);
  for (let i = 0; i < sampleSize; i++) {
    const detail = await (await fetch(`${BASE}/api/sources/${webSources[i].id}`)).json();
    const content = detail.content?.full || '';
    const words = content.split(/\s+/).filter(Boolean).length;
    webTotalWords += words;
    if (words < 50) webUnder50++;
    if (words < 100) webUnder100++;
  }

  console.log(`\n--- Web Audit (sample of ${sampleSize}) ---`);
  console.log(`  Total words in sample:    ${webTotalWords.toLocaleString()}`);
  console.log(`  Avg words/source:         ${Math.round(webTotalWords / sampleSize)}`);
  console.log(`  Under 50 words:           ${webUnder50}`);
  console.log(`  Under 100 words:          ${webUnder100}`);
  console.log(`  Estimated total web words: ~${Math.round(webTotalWords / sampleSize * webSources.length).toLocaleString()}`);
  
  console.log(`\n=== DONE ===\n`);
}

main().catch(console.error);
