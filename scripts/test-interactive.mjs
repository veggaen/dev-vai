#!/usr/bin/env node
/**
 * Interactive Training & Test Benchmark
 * ──────────────────────────────────────
 * 10  Control questions        (general knowledge)
 * 10  Norway history           (1 per fylke)
 * 10  Tailwind CSS v4          (3 best practices, 3 changes, 4 concepts)
 * 10  Real-world facts         (1994–2011, newspapers / blog posts / public exams)
 * ──────────────────────────────────────
 * Total: 40 questions — each followed by interactive feedback to VAI
 *
 * For every question the script:
 *   1. Asks VAI the question
 *   2. Evaluates the answer (pass / fail)
 *   3. Tells VAI whether the answer was correct or incorrect, with reasoning
 *   4. Sends "I'll take your response into consideration"
 *   5. Moves to the next question
 *
 * Usage: node scripts/test-interactive.mjs
 */
import WebSocket from 'ws';

const API     = 'http://localhost:3006';
const WS_URL  = 'ws://localhost:3006/api/chat';
const TIMEOUT = 20_000;

/* ═══════════════ Helpers ═══════════════ */

async function chatWithVai(conversationId, message, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: message })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) {
        response += msg.textDelta;
        process.stdout.write(msg.textDelta);
      } else if (msg.type === 'done') { gotDone = true; ws.close(); }
      else if (msg.type === 'error') { ws.close(); reject(new Error(msg.error)); }
    });
    ws.on('close', () => resolve(response || '[no response]'));
    ws.on('error', (err) => reject(err));
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, timeoutMs);
  });
}

async function createConv(title) {
  const res = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await res.json()).id;
}

/** Ask a question, print it, return the raw answer text */
async function ask(convId, msg) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`>> You: ${msg}`);
  console.log(`<< VAI:`);
  const answer = await chatWithVai(convId, msg);
  if (!answer.endsWith('\n')) console.log('');
  return answer;
}

/** Send feedback silently (don't clutter the log with VAI's acknowledgment) */
async function sendFeedback(convId, feedbackMsg) {
  console.log(`   📝 Feedback → ${feedbackMsg.slice(0, 100)}${feedbackMsg.length > 100 ? '…' : ''}`);
  await chatWithVai(convId, feedbackMsg); // VAI processes it
}

/** The standard continuation phrase after feedback */
async function sendConsideration(convId) {
  console.log(`   🔄 "I'll take your response into consideration"`);
  await chatWithVai(convId, "I'll take your response into consideration.");
}

/**
 * Run a full question cycle: ask → evaluate → feedback → consider → score
 * Returns true if passed
 */
async function runQuestion(convId, q, idx, sectionLabel) {
  const prefix = `[${sectionLabel} Q${idx}]`;
  const answer = await ask(convId, q.question);
  const passed = q.validate(answer);

  if (passed) {
    console.log(`   ✅ ${prefix} CORRECT`);
    await sendFeedback(convId,
      `That was correct! ${q.correctFeedback}`);
  } else {
    console.log(`   ❌ ${prefix} INCORRECT — expected: ${q.expected}`);
    await sendFeedback(convId,
      `That was incorrect. ${q.incorrectFeedback} The correct answer is: ${q.expected}`);
  }
  await sendConsideration(convId);
  return passed;
}

/* ═══════════════ Section 1: Control Questions ═══════════════ */

const controlQuestions = [
  {
    question: 'What is the capital of Australia?',
    expected: 'Canberra',
    validate: r => /canberra/i.test(r),
    correctFeedback: 'Canberra has been Australia\'s capital since 1927, chosen as a compromise between Sydney and Melbourne.',
    incorrectFeedback: 'A common mistake is to say Sydney or Melbourne — the actual capital is Canberra.',
  },
  {
    question: 'In what year did the Berlin Wall fall?',
    expected: '1989',
    validate: r => /1989/.test(r),
    correctFeedback: 'The Berlin Wall fell on November 9, 1989, a pivotal moment in Cold War history.',
    incorrectFeedback: 'The Berlin Wall fell in 1989, specifically on November 9th.',
  },
  {
    question: 'What is the chemical formula for water?',
    expected: 'H2O',
    validate: r => /H2O|H₂O/i.test(r),
    correctFeedback: 'H₂O — two hydrogen atoms bonded to one oxygen atom.',
    incorrectFeedback: 'Water is H₂O — two hydrogen atoms and one oxygen atom.',
  },
  {
    question: 'Who wrote the play "Romeo and Juliet"?',
    expected: 'William Shakespeare',
    validate: r => /shakespeare/i.test(r),
    correctFeedback: 'William Shakespeare wrote Romeo and Juliet around 1594–1596.',
    incorrectFeedback: 'Romeo and Juliet was written by William Shakespeare.',
  },
  {
    question: 'What is the approximate speed of light in a vacuum, in km/s?',
    expected: '~300,000 km/s (299,792 km/s)',
    validate: r => /299[\s,.]?792|300[\s,.]?000|3\s*×\s*10\^?8|3\s*x\s*10\^?8|3e8/i.test(r),
    correctFeedback: 'The speed of light is approximately 299,792 km/s or roughly 3×10⁸ m/s.',
    incorrectFeedback: 'The speed of light in a vacuum is approximately 299,792 km/s (about 300,000 km/s).',
  },
  {
    question: 'What planet in our solar system is known as the Red Planet?',
    expected: 'Mars',
    validate: r => /\bmars\b/i.test(r),
    correctFeedback: 'Mars appears red due to iron oxide (rust) on its surface.',
    incorrectFeedback: 'Mars is called the Red Planet because of the iron oxide on its surface.',
  },
  {
    question: 'What is the largest ocean on Earth?',
    expected: 'Pacific Ocean',
    validate: r => /pacific/i.test(r),
    correctFeedback: 'The Pacific Ocean covers about 165.25 million km², more than all land area combined.',
    incorrectFeedback: 'The Pacific Ocean is the largest, covering about one-third of Earth\'s surface.',
  },
  {
    question: 'What is the smallest prime number?',
    expected: '2',
    validate: r => /\b2\b/.test(r) && /prime|smallest/i.test(r + ' prime'),
    correctFeedback: '2 is the smallest prime and the only even prime number.',
    incorrectFeedback: '2 is the smallest prime number — and notably the only even prime.',
  },
  {
    question: 'What programming language was created by Brendan Eich at Netscape in 1995?',
    expected: 'JavaScript',
    validate: r => /javascript/i.test(r),
    correctFeedback: 'Brendan Eich created JavaScript (originally Mocha, then LiveScript) in just 10 days in May 1995.',
    incorrectFeedback: 'Brendan Eich created JavaScript at Netscape in 1995.',
  },
  {
    question: 'How many bits are in one byte?',
    expected: '8 bits',
    validate: r => /\b8\b/.test(r),
    correctFeedback: 'One byte = 8 bits, standardized since the early days of computing.',
    incorrectFeedback: 'One byte contains 8 bits.',
  },
];

/* ═══════════════ Section 2: Norway History (1 per fylke) ═══════════════ */

const norwayHistoryQuestions = [
  {
    // Rogaland
    question: 'Norway history, Rogaland: What major oil field was discovered in the North Sea in 1969, transforming Stavanger into the oil capital of Norway?',
    expected: 'Ekofisk',
    validate: r => /ekofisk/i.test(r),
    correctFeedback: 'The Ekofisk field was discovered on December 23, 1969 by Phillips Petroleum. It was announced in June 1970 and transformed Norway\'s economy.',
    incorrectFeedback: 'The Ekofisk oil field was discovered in 1969 and marked the beginning of Norway\'s era as a petroleum nation.',
  },
  {
    // Vestland (Bergen)
    question: 'Norway history, Vestland: What medieval trading post established by the Hanseatic League in Bergen is now a UNESCO World Heritage Site?',
    expected: 'Bryggen (Tyskebryggen)',
    validate: r => /bryggen|tyskebryggen|hanse/i.test(r),
    correctFeedback: 'Bryggen (formerly Tyskebryggen) was the Hanseatic commercial center in Bergen from the 14th century onwards, and became a UNESCO site in 1979.',
    incorrectFeedback: 'Bryggen (the old wharf) in Bergen was the Hanseatic League\'s main trading post in Norway and is now a UNESCO World Heritage Site.',
  },
  {
    // Oslo
    question: 'Norway history, Oslo: In what year did Oslo host the Winter Olympic Games?',
    expected: '1952',
    validate: r => /1952/.test(r),
    correctFeedback: 'The 1952 Winter Olympics in Oslo were the first to be held in a Scandinavian capital. Events were held at Bislett Stadium and Holmenkollen.',
    incorrectFeedback: 'Oslo hosted the Winter Olympics in 1952 — the VI Olympic Winter Games.',
  },
  {
    // Innlandet (Eidsvoll)
    question: 'Norway history, Innlandet: Where was the Norwegian Constitution signed on May 17, 1814, and who was elected as Norway\'s first king?',
    expected: 'Eidsvoll; Christian Frederik',
    validate: r => /eidsvoll/i.test(r),
    correctFeedback: 'The Constitution was signed at Eidsvoll on May 17, 1814. Christian Frederik was elected king. This date is celebrated as Norway\'s national day.',
    incorrectFeedback: 'The Norwegian Constitution was signed at Eidsvoll (Eidsvollsbygningen) on May 17, 1814.',
  },
  {
    // Vestfold
    question: 'Norway history, Vestfold: What famous Viking ship was excavated from a burial mound in Sandefjord in 1880, and is now displayed in Oslo?',
    expected: 'Gokstad ship (Gokstadskipet)',
    validate: r => /gokstad/i.test(r),
    correctFeedback: 'The Gokstad ship was excavated in 1880 from a mound in Sandefjord. It dates to around 890 AD and is displayed at the Viking Ship Museum in Oslo.',
    incorrectFeedback: 'The Gokstad Viking ship was found in a burial mound near Sandefjord in Vestfold in 1880.',
  },
  {
    // Trøndelag (Trondheim)
    question: 'Norway history, Trøndelag: What is the historical significance of Nidarosdomen (Nidaros Cathedral) in Trondheim?',
    expected: 'Built over the grave of St. Olav / coronation church of Norwegian kings',
    validate: r => /olav|coronation|kron|pilgrimage|pilegrim|burial|grav|national\s+sanct/i.test(r),
    correctFeedback: 'Nidarosdomen was built over the burial site of King Olav II (St. Olav) who fell at the Battle of Stiklestad in 1030. It served as the coronation church for Norwegian kings.',
    incorrectFeedback: 'Nidaros Cathedral was built over the grave of St. Olav (King Olav II Haraldsson) and served as the coronation church for Norwegian kings.',
  },
  {
    // Finnmark
    question: 'Norway history, Finnmark: What devastating military operation happened in Finnmark in late 1944 during WWII?',
    expected: 'The Germans burned/destroyed nearly all of Finnmark during their retreat (tvangsevakuering)',
    validate: r => /burn|brent|bren|destro|evacu|tvangs|scorch|retreat|nedbren/i.test(r),
    correctFeedback: 'In October–November 1944, the retreating German forces employed a scorched-earth policy, burning nearly every building in Finnmark and northern Troms, and forcibly evacuating the population.',
    incorrectFeedback: 'The Germans burned almost all of Finnmark during their retreat in late 1944, using a scorched-earth strategy. Roughly 11,000 buildings were destroyed.',
  },
  {
    // Nordland (Lofoten)
    question: 'Norway history, Nordland: What centuries-old seasonal fishing tradition in the Lofoten Islands has been central to the economy of Nordland?',
    expected: 'Lofotfisket (the Lofoten cod fishery)',
    validate: r => /lofotfisk|cod\s*fish|torsk|skrei|tørrfisk|stockfisk|dried\s*fish/i.test(r),
    correctFeedback: 'Lofotfisket — the seasonal cod fishery — has been a cornerstone of Nordland\'s economy for over 1,000 years. Arctic cod (skrei) migrate to Lofoten every winter.',
    incorrectFeedback: 'Lofotfisket, the Lofoten cod fishery, has drawn fishermen to Nordland for over a millennium. Dried fish (tørrfisk) from Lofoten was exported across Europe.',
  },
  {
    // Agder
    question: 'Norway history, Agder: What major industry made the Agder region (Kristiansand/Arendal) one of the leading maritime centers in the 19th century?',
    expected: 'Sailing ship industry / shipping (seilskutetiden)',
    validate: r => /sail|shipping|seilskute|maritime|sjøfart|skip|vessel/i.test(r),
    correctFeedback: 'Agder was a center of the sailing ship era (seilskutetiden). In the 1870s, Norway had the world\'s third-largest merchant fleet, heavily based in Agder.',
    incorrectFeedback: 'During the 19th century, Agder was a major center for the sailing ship industry (seilskutetiden) and shipping.',
  },
  {
    // Troms
    question: 'Norway history, Troms: What critical WWII naval battle took place near Tromsø in November 1944, leading to the sinking of a famous German battleship?',
    expected: 'The sinking of the Tirpitz',
    validate: r => /tirpitz/i.test(r),
    correctFeedback: 'The German battleship Tirpitz was sunk by RAF Lancaster bombers on November 12, 1944, in Tromsøysundet near Tromsø. Over 1,000 crew members died.',
    incorrectFeedback: 'The battleship Tirpitz was sunk near Tromsø on November 12, 1944, by British RAF bombers using Tallboy bombs.',
  },
];

/* ═══════════════ Section 3: Tailwind CSS v4 ═══════════════ */

const tailwindQuestions = [
  // ── Best practices (3) ──
  {
    question: 'Tailwind v4 best practice: In Tailwind CSS v4, what is the recommended way to configure design tokens and theme values instead of using tailwind.config.js?',
    expected: '@theme directive in CSS',
    validate: r => /@theme/i.test(r),
    correctFeedback: 'In Tailwind v4, you use the @theme directive directly in your CSS file to define design tokens — no JavaScript config needed.',
    incorrectFeedback: 'Tailwind v4 uses a CSS-first approach with the @theme directive instead of tailwind.config.js.',
  },
  {
    question: 'Tailwind v4 best practice: What color format does Tailwind v4 default to for perceptually uniform colors, and why is it better than rgb/hsl?',
    expected: 'OKLCH — perceptually uniform across hues',
    validate: r => /oklch/i.test(r),
    correctFeedback: 'Tailwind v4 uses OKLCH (Oklab Lightness Chroma Hue) by default. It provides better perceptual uniformity — colors at the same lightness actually look equally bright.',
    incorrectFeedback: 'Tailwind v4 defaults to OKLCH format. OKLCH is perceptually uniform, meaning equal lightness values look equally bright across all hues.',
  },
  {
    question: 'Tailwind v4 best practice: What is the "two-tier variable system" pattern recommended in Tailwind v4 for managing design tokens?',
    expected: 'Design token layer (raw colors) + semantic mapping layer (e.g. --color-primary: var(--color-blue-600))',
    validate: r => /semantic|token|var\s*\(--color|primary.*blue|mapping|two.*tier/i.test(r),
    correctFeedback: 'The two-tier system separates raw design tokens (--color-blue-600) from semantic variables (--color-primary: var(--color-blue-600)) for maintainability.',
    incorrectFeedback: 'The two-tier variable system uses raw design tokens mapped to semantic variables with CSS var() references.',
  },
  // ── Changes since v3 (3) ──
  {
    question: 'Tailwind v4 changes: What build tool does Tailwind v4 use by default instead of PostCSS for Vite projects?',
    expected: '@tailwindcss/vite plugin',
    validate: r => /@tailwindcss\/vite|tailwindcss.*vite\s*plugin/i.test(r),
    correctFeedback: 'Tailwind v4 ships a dedicated @tailwindcss/vite plugin, replacing the PostCSS-based setup from v3.',
    incorrectFeedback: 'Tailwind v4 uses @tailwindcss/vite as its build plugin for Vite projects instead of PostCSS.',
  },
  {
    question: 'Tailwind v4 changes: How has the CSS entry point changed from v3 to v4? What do you write instead of the @tailwind directives?',
    expected: '@import "tailwindcss" (instead of @tailwind base/components/utilities)',
    validate: r => /@import\s*['"]tailwindcss['"]|@import\s+tailwindcss/i.test(r),
    correctFeedback: 'In v4 you simply write @import "tailwindcss" instead of the three @tailwind base/components/utilities directives from v3.',
    incorrectFeedback: 'Tailwind v4 simplifies the CSS entry to just @import "tailwindcss" — no more separate @tailwind directives.',
  },
  {
    question: 'Tailwind v4 changes: What configuration files are no longer needed in a Tailwind v4 project compared to v3?',
    expected: 'tailwind.config.js and postcss.config.js (when using Vite)',
    validate: r => /tailwind\.config|postcss\.config|no.*config|config.*eliminat/i.test(r),
    correctFeedback: 'Tailwind v4 eliminates both tailwind.config.js (replaced by @theme in CSS) and postcss.config.js (replaced by the Vite plugin).',
    incorrectFeedback: 'Tailwind v4 no longer requires tailwind.config.js or postcss.config.js — configuration lives in CSS via @theme.',
  },
  // ── Concepts / usage (4) ──
  {
    question: 'Tailwind v4 concept: What are the three modes of the @theme directive in Tailwind v4, and briefly what does each do?',
    expected: 'default (CSS variables), inline (direct values), reference (fallbacks without vars)',
    validate: r => /\bdefault\b.*\binline\b.*\breference\b|\binline\b.*\breference\b.*\bdefault\b|\breference\b.*\bdefault\b.*\binline\b/i.test(r)
      || (r.match(/\b(default|inline|reference)\b/gi) || []).length >= 3,
    correctFeedback: 'The three @theme modes are: default (generates CSS variables), inline (inlines values for performance), and reference (fallbacks without emitting variables).',
    incorrectFeedback: 'The three @theme modes are default (CSS variables), inline (direct value substitution), and reference (fallback values without :root variables).',
  },
  {
    question: 'Tailwind v4 concept: When should you use @theme inline instead of the default @theme mode?',
    expected: 'Use inline for static values, better performance (no CSS variable overhead); use default for dynamic/JS-driven themes',
    validate: r => /performance|static|inline|overhead|dynamic/i.test(r),
    correctFeedback: 'Use @theme inline for static values where you want better performance (no CSS variable overhead). Use default when you need JS access or dynamic theming.',
    incorrectFeedback: '@theme inline skips CSS variable generation for better performance. Use it for static values; use default for dynamic theming with JS.',
  },
  {
    question: 'Tailwind v4 concept: How do you define custom animations with keyframes in Tailwind v4?',
    expected: '@theme inline { --animate-name: ...; @keyframes name { ... } }',
    validate: r => /@theme.*inline|@keyframes|--animate/i.test(r),
    correctFeedback: 'Define animations inside @theme inline with --animate-name and a @keyframes block. Usage: animate-name class.',
    incorrectFeedback: 'In Tailwind v4, custom animations go inside @theme inline: define --animate-name and @keyframes together.',
  },
  {
    question: 'Tailwind v4 concept: How does the spacing scale work in Tailwind v4 using CSS variables?',
    expected: '--spacing: 0.25rem as base unit, multiplied by the number (e.g. p-4 = 1rem)',
    validate: r => /--spacing|0\.25\s*rem|base\s*unit|multiplied|multiply|spacing\s*scale/i.test(r),
    correctFeedback: 'Tailwind v4 uses --spacing: 0.25rem as a base unit. Utilities multiply it: p-4 = 4 × 0.25rem = 1rem.',
    incorrectFeedback: 'In v4, spacing uses --spacing: 0.25rem as its base value. p-4 becomes 4 × 0.25rem = 1rem.',
  },
];

/* ═══════════════ Section 4: Real-World Facts (1994–2011) ═══════════════ */

const realWorldQuestions = [
  {
    question: 'Real-world fact (1994): Where were the 1994 Winter Olympic Games held, and what was notable about the opening ceremony?',
    expected: 'Lillehammer, Norway',
    validate: r => /lillehammer/i.test(r),
    correctFeedback: 'The 1994 Winter Olympics were held in Lillehammer, Norway, from February 12–27. The opening featured a ski jump stunt carrying the Olympic torch. It was widely regarded as one of the best-organized Games.',
    incorrectFeedback: 'The 1994 Winter Olympics were held in Lillehammer, Norway — the last time a Winter and Summer Olympics were held two years apart.',
  },
  {
    question: 'Real-world fact (1997): In May 1997, a chess match captured world attention. What computer defeated world chess champion Garry Kasparov, and who built it?',
    expected: 'Deep Blue, built by IBM',
    validate: r => /deep\s*blue/i.test(r),
    correctFeedback: 'IBM\'s Deep Blue defeated Garry Kasparov 3.5–2.5 in their six-game rematch in May 1997. It was the first time a computer beat a reigning world champion under standard conditions.',
    incorrectFeedback: 'Deep Blue, built by IBM, defeated Garry Kasparov in May 1997.',
  },
  {
    question: 'Real-world fact (1998): What technology company was founded by Larry Page and Sergey Brin in September 1998 while they were PhD students at Stanford?',
    expected: 'Google',
    validate: r => /google/i.test(r),
    correctFeedback: 'Google was founded on September 4, 1998, in a garage in Menlo Park, California. The name comes from "googol" (10^100).',
    incorrectFeedback: 'Google was founded by Larry Page and Sergey Brin in September 1998.',
  },
  {
    question: 'Real-world fact (2001): What free online encyclopedia was launched on January 15, 2001, by Jimmy Wales and Larry Sanger?',
    expected: 'Wikipedia',
    validate: r => /wikipedia/i.test(r),
    correctFeedback: 'Wikipedia launched on January 15, 2001. It grew to become the largest encyclopedia in history with over 60 million articles across 300+ languages.',
    incorrectFeedback: 'Wikipedia was launched on January 15, 2001.',
  },
  {
    question: 'Real-world fact (2004): According to a widely-reported Aftenposten article, Norway established its Government Pension Fund Global (Statens pensjonsfond utland, commonly known as the "Oil Fund") to manage petroleum revenues. In approximately what year was this fund formally established?',
    expected: '1990 (formally, though significant growth happened from the mid-1990s onward)',
    validate: r => /1990|1996|oil\s*fund|pensjonsfond|government\s*pension/i.test(r),
    correctFeedback: 'The Government Pension Fund Global was established in 1990 (first deposit in 1996). By the mid-2000s it had become one of the world\'s largest sovereign wealth funds.',
    incorrectFeedback: 'Norway\'s Government Pension Fund Global (Oil Fund) was formally established in 1990 with the first capital transfer in 1996.',
  },
  {
    question: 'Real-world fact (2005): What video-sharing platform was founded in February 2005 by three former PayPal employees — Chad Hurley, Steve Chen, and Jawed Karim?',
    expected: 'YouTube',
    validate: r => /youtube/i.test(r),
    correctFeedback: 'YouTube was founded in February 2005. The first video, "Me at the zoo" by Jawed Karim, was uploaded on April 23, 2005. Google acquired YouTube for $1.65 billion in October 2006.',
    incorrectFeedback: 'YouTube was founded in February 2005 by Chad Hurley, Steve Chen, and Jawed Karim.',
  },
  {
    question: 'Real-world fact (2007): What revolutionary consumer electronics product did Apple announce on January 9, 2007, combining a phone, widescreen iPod, and internet device?',
    expected: 'iPhone',
    validate: r => /iphone/i.test(r),
    correctFeedback: 'Steve Jobs announced the iPhone on January 9, 2007, at Macworld. It went on sale June 29, 2007, and fundamentally changed the smartphone industry.',
    incorrectFeedback: 'The iPhone was announced by Steve Jobs on January 9, 2007.',
  },
  {
    question: 'Real-world fact (2008): What major global financial event began in September 2008, triggered by the collapse of Lehman Brothers? Norwegian newspapers like VG and Dagbladet covered it extensively as "finanskrisen".',
    expected: 'The global financial crisis / Great Recession (finanskrisen)',
    validate: r => /financial\s*crisis|great\s*recession|finanskris|lehman|bank.*crisis|credit\s*crisis/i.test(r),
    correctFeedback: 'The 2008 financial crisis (finanskrisen) was triggered by the collapse of Lehman Brothers on September 15, 2008. It led to the worst global recession since the 1930s.',
    incorrectFeedback: 'The 2008 global financial crisis was triggered by Lehman Brothers\' collapse on September 15, 2008.',
  },
  {
    question: 'Real-world fact (2001-2010): During the first decade of the 2000s, what Norwegian online newspaper became the most-read in Norway, surpassing its print circulation? (Hint: it is a tabloid starting with "V")',
    expected: 'VG (Verdens Gang)',
    validate: r => /\bVG\b|verdens\s*gang/i.test(r),
    correctFeedback: 'VG.no (Verdens Gang) became Norway\'s most-read online newspaper in the early 2000s, pioneering digital journalism in Scandinavia.',
    incorrectFeedback: 'VG (Verdens Gang) became Norway\'s most-read online news source, leading the digital transformation of Norwegian media.',
  },
  {
    question: 'Real-world fact: When it comes to finding 100% reliable facts and verifiable information, what are the best primary source categories to consult? Give examples of source types that are considered most reliable.',
    expected: 'Government records, peer-reviewed journals, official statistics (SSB/Statistics Norway), court documents, patent filings',
    validate: r => /government|peer.review|official|statist|journal|court|primary\s*source|academi|SSB|census/i.test(r),
    correctFeedback: 'The most reliable sources are: government/official records, peer-reviewed academic journals, official statistics (like SSB in Norway), court documents, and verified archives.',
    incorrectFeedback: 'For 100% reliable facts, prioritize: government records, peer-reviewed journals, official statistics (SSB), and verified primary sources.',
  },
];

/* ═══════════════ Runner ═══════════════ */

async function runSection(title, questions) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(70)}`);

  const convId = await createConv(title);
  let passed = 0;
  const total = questions.length;
  const failures = [];

  for (let i = 0; i < total; i++) {
    const ok = await runQuestion(convId, questions[i], i + 1, title.slice(0, 12));
    if (ok) passed++;
    else failures.push({ idx: i + 1, expected: questions[i].expected, question: questions[i].question.slice(0, 80) });
  }

  console.log(`\n┌─ ${title} Result: ${passed}/${total} ─┐`);
  if (failures.length) {
    failures.forEach(f => console.log(`│  ✗ Q${f.idx}: ${f.question}…`));
    console.log(`│     Expected: ${failures.map(f => f.expected).join(' | ')}`);
  }
  console.log(`└${'─'.repeat(40)}┘`);
  return { passed, total, failures };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     VAI Interactive Training & Test Benchmark               ║');
  console.log('║     40 questions — 4 sections — with feedback loops         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Health check
  try {
    const h = await fetch(`${API}/health`);
    if (!h.ok) throw new Error(`Health check failed: ${h.status}`);
    console.log('\n✓ Server is healthy');
  } catch (e) {
    console.error(`\n✗ Server not reachable at ${API} — start it first!`);
    process.exit(1);
  }

  const results = [];

  results.push(await runSection('Control Questions', controlQuestions));
  results.push(await runSection('Norway History (Fylke)', norwayHistoryQuestions));
  results.push(await runSection('Tailwind CSS v4', tailwindQuestions));
  results.push(await runSection('Real-World Facts (1994–2011)', realWorldQuestions));

  // ── Final Summary ──
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalQ      = results.reduce((s, r) => s + r.total, 0);
  const allFailures = results.flatMap(r => r.failures);

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL SUMMARY                            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  const sections = ['Control Questions', 'Norway History', 'Tailwind v4', 'Real-World Facts'];
  results.forEach((r, i) => {
    const status = r.passed === r.total ? '✅' : '❌';
    console.log(`║  ${status} ${sections[i].padEnd(25)} ${String(r.passed).padStart(2)}/${String(r.total).padStart(2)}        ║`);
  });
  console.log('╠══════════════════════════════════════════════════════════════╣');
  const emoji = totalPassed === totalQ ? '🏆' : '📊';
  console.log(`║  ${emoji} TOTAL: ${totalPassed}/${totalQ}                                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (allFailures.length) {
    console.log('\n── Failed Questions ──');
    allFailures.forEach(f => {
      console.log(`  Q${f.idx}: ${f.question}`);
      console.log(`       Expected: ${f.expected}`);
    });
  }

  if (totalPassed === totalQ) {
    console.log('\n🎯 PERFECT SCORE! 40/40 — All sections passed.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
