import { VaiEngine } from '../packages/core/src/models/vai-engine.js';

/**
 * Comprehensive URL edge-case test suite.
 * Tests multi-turn flows, retheme/resubject/redesign intent, and diverse repos.
 */

interface TestCase {
  label: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expect: {
    strategy?: string | RegExp;
    contains?: (string | RegExp)[];
    notContains?: (string | RegExp)[];
    minLength?: number;
  };
}

const tests: TestCase[] = [
  // ═══════════ 1. MULTI-TURN: review → build flow ═══════════
  {
    label: 'Review lawn repo (bare look)',
    messages: [{ role: 'user', content: 'Take a look at https://github.com/pingdotgg/lawn' }],
    expect: {
      strategy: 'url-request',
      contains: [/pingdotgg\/lawn/i, /TypeScript|language/i],
      notContains: [/youtube/i, /UBERMAN/i],
    },
  },
  {
    label: 'Follow-up: now build it',
    messages: [
      { role: 'user', content: 'Take a look at https://github.com/pingdotgg/lawn' },
      { role: 'assistant', content: '**pingdotgg/lawn**\n\n**Language:** TypeScript · **Stars:** 565 · **Homepage:** https://lawn.video\n\n**What would you like to do?**\n- `rebuild pingdotgg/lawn`\n- Describe specific features' },
      { role: 'user', content: 'now build it for me' },
    ],
    expect: {
      // Should recognize "build" + URL context from history
      contains: [/html|```|code|project|build/i],
      notContains: [/youtube/i, /UBERMAN/i],
    },
  },
  {
    label: 'Follow-up: different theme',
    messages: [
      { role: 'user', content: 'rebuild https://github.com/pingdotgg/lawn' },
      { role: 'assistant', content: 'I looked up **pingdotgg/lawn** (TypeScript, 565 stars)\n\nHere\'s a starter...\n```html\n<!DOCTYPE html>...\n```' },
      { role: 'user', content: 'make it the same but with a different theme, more purple and neon' },
    ],
    expect: {
      contains: [/purple|neon|theme|color/i],
      notContains: [/youtube/i, /can't browse/i],
    },
  },
  {
    label: 'Follow-up: different subject',
    messages: [
      { role: 'user', content: 'rebuild https://github.com/pingdotgg/lawn' },
      { role: 'assistant', content: 'Here\'s a link-in-bio page...\n```html\n<!DOCTYPE html>...\n```' },
      { role: 'user', content: 'same design but make it about photography instead' },
    ],
    expect: {
      contains: [/photo/i],
      notContains: [/youtube/i],
    },
  },

  // ═══════════ 2. SAME DESIGN / DIFFERENT APP ═══════════
  {
    label: 'Build similar app but different',
    messages: [{ role: 'user', content: 'build something like https://github.com/pingdotgg/lawn but for sharing music links' }],
    expect: {
      strategy: 'url-request',
      contains: [/pingdotgg\/lawn|music|link/i],
    },
  },
  {
    label: 'Same layout different app',
    messages: [{ role: 'user', content: 'I want the same layout and UI as https://github.com/pingdotgg/lawn but for a restaurant menu' }],
    expect: {
      strategy: 'url-request',
      contains: [/lawn|restaurant|menu/i],
    },
  },

  // ═══════════ 3. PINGDOTGG REPOS (diverse types) ═══════════
  {
    label: 'uploadthing - file uploads (has description)',
    messages: [{ role: 'user', content: 'rebuild https://github.com/pingdotgg/uploadthing' }],
    expect: {
      strategy: 'url-request',
      contains: [/uploadthing|file.?upload/i],
      notContains: [/youtube/i],
    },
  },
  {
    label: 'uploadthing - look at',
    messages: [{ role: 'user', content: 'check out https://github.com/pingdotgg/uploadthing' }],
    expect: {
      strategy: 'url-request',
      contains: [/uploadthing/i, /file.?upload|modern.?web/i],
    },
  },
  {
    label: 't3code - big repo, no description',
    messages: [{ role: 'user', content: 'build me something like https://github.com/pingdotgg/t3code' }],
    expect: {
      strategy: 'url-request',
      contains: [/t3code|pingdotgg/i],
      notContains: [/youtube/i],
    },
  },
  {
    label: 'markerthing - specific tool',
    messages: [{ role: 'user', content: 'what is https://github.com/pingdotgg/markerthing' }],
    expect: {
      strategy: 'url-request',
      contains: [/markerthing/i, /twitch|marker|csv|export/i],
    },
  },
  {
    label: 'zact - archived repo, troll description',
    messages: [{ role: 'user', content: 'take a look at https://github.com/pingdotgg/zact' }],
    expect: {
      strategy: 'url-request',
      contains: [/zact/i],
      notContains: [/youtube/i],
    },
  },
  {
    label: 'webhookthing - dev tool',
    messages: [{ role: 'user', content: 'rebuild https://github.com/pingdotgg/webhookthing for me' }],
    expect: {
      strategy: 'url-request',
      contains: [/webhookthing/i],
    },
  },

  // ═══════════ 4. NON-GITHUB URLS ═══════════
  {
    label: 'Non-GitHub URL with build intent',
    messages: [{ role: 'user', content: 'build something like https://stripe.com/docs' }],
    expect: {
      strategy: 'url-request',
      contains: [/stripe\.com|build|inspired/i],
      notContains: [/youtube/i],
    },
  },
  {
    label: 'Non-GitHub URL bare (no intent)',
    messages: [{ role: 'user', content: 'https://www.google.com' }],
    expect: {
      // Should NOT be caught by url-request (no intent)
      notContains: [/youtube/i, /UBERMAN/i],
    },
  },

  // ═══════════ 5. EDGE CASES ═══════════
  {
    label: 'URL with trailing punctuation',
    messages: [{ role: 'user', content: 'can you rebuild https://github.com/pingdotgg/lawn?' }],
    expect: {
      strategy: 'url-request',
      contains: [/pingdotgg\/lawn/i],
    },
  },
  {
    label: 'Multiple URLs in one message',
    messages: [{ role: 'user', content: 'look at https://github.com/pingdotgg/lawn and https://github.com/pingdotgg/uploadthing' }],
    expect: {
      strategy: 'url-request',
      contains: [/lawn|uploadthing/i],
    },
  },
  {
    label: 'URL embedded in sentence',
    messages: [{ role: 'user', content: 'I found this cool project https://github.com/pingdotgg/lawn and I want to make something similar for my portfolio' }],
    expect: {
      strategy: 'url-request',
      contains: [/lawn|similar|portfolio/i],
    },
  },
  {
    label: 'GitHub URL to non-existent repo',
    messages: [{ role: 'user', content: 'rebuild https://github.com/nonexistent-user-xyzzy/fake-repo-12345' }],
    expect: {
      strategy: 'url-request',
      contains: [/nonexistent|fake|couldn't|tell me|build/i],
      notContains: [/youtube/i],
    },
  },
  {
    label: 'Clone intent (should trigger build)',
    messages: [{ role: 'user', content: 'clone https://github.com/pingdotgg/lawn' }],
    expect: {
      strategy: 'url-request',
      contains: [/lawn/i],
    },
  },
  {
    label: 'Recreate intent',
    messages: [{ role: 'user', content: 'recreate https://github.com/pingdotgg/uploadthing but simpler' }],
    expect: {
      strategy: 'url-request',
      contains: [/uploadthing/i],
    },
  },
];

async function main() {
  const engine = new VaiEngine();
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  URL EDGE CASE TEST SUITE');
  console.log(`${'═'.repeat(60)}\n`);

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const t of tests) {
    const result = await engine.chat({ messages: t.messages });
    const strategy = engine.lastResponseMeta?.strategy ?? '??';
    const content = result.message.content;
    const issues: string[] = [];

    // Check strategy
    if (t.expect.strategy) {
      if (typeof t.expect.strategy === 'string' && strategy !== t.expect.strategy) {
        issues.push(`strategy: expected "${t.expect.strategy}" got "${strategy}"`);
      } else if (t.expect.strategy instanceof RegExp && !t.expect.strategy.test(strategy)) {
        issues.push(`strategy: expected ${t.expect.strategy} got "${strategy}"`);
      }
    }

    // Check contains
    for (const c of t.expect.contains || []) {
      if (typeof c === 'string' && !content.includes(c)) {
        issues.push(`missing: "${c}"`);
      } else if (c instanceof RegExp && !c.test(content)) {
        issues.push(`missing: ${c}`);
      }
    }

    // Check notContains
    for (const nc of t.expect.notContains || []) {
      if (typeof nc === 'string' && content.includes(nc)) {
        issues.push(`unexpected: "${nc}"`);
      } else if (nc instanceof RegExp && nc.test(content)) {
        issues.push(`unexpected: ${nc}`);
      }
    }

    // Check minLength
    if (t.expect.minLength && content.length < t.expect.minLength) {
      issues.push(`too short: ${content.length} < ${t.expect.minLength}`);
    }

    if (issues.length === 0) {
      pass++;
      console.log(`  PASS  ${t.label} [${strategy}]`);
    } else {
      fail++;
      const failMsg = `  FAIL  ${t.label} [${strategy}]\n${issues.map(i => `        - ${i}`).join('\n')}\n        response: ${content.slice(0, 150).replace(/\n/g, ' ')}`;
      console.log(failMsg);
      failures.push(failMsg);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  RESULT: ${pass}/${pass + fail} PASS  (${fail} failures)`);
  console.log(`${'─'.repeat(60)}`);

  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    failures.forEach(f => console.log(f));
  }
}

main().catch(console.error);
