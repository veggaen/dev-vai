/**
 * Quality audit: send real prompts to VaiEngine and print every response.
 * Run with: npx tsx scripts/audit-responses.ts
 */
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';

const engine = new VaiEngine();

const prompts: { label: string; messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> }[] = [
  // --- Greetings ---
  { label: 'English greeting', messages: [{ role: 'user', content: 'hello' }] },
  { label: 'Norwegian greeting', messages: [{ role: 'user', content: 'hei' }] },
  { label: 'Hey', messages: [{ role: 'user', content: 'hey' }] },

  // --- Short topics ---
  { label: 'Docker (short)', messages: [{ role: 'user', content: 'docker' }] },
  { label: 'Python (short)', messages: [{ role: 'user', content: 'python' }] },
  { label: 'React (short)', messages: [{ role: 'user', content: 'react' }] },
  { label: 'Cache (short)', messages: [{ role: 'user', content: 'cache' }] },
  { label: 'Recursion (short)', messages: [{ role: 'user', content: 'recursion' }] },

  // --- Real questions ---
  { label: 'What is TypeScript', messages: [{ role: 'user', content: 'what is typescript' }] },
  { label: 'What is Rust', messages: [{ role: 'user', content: 'what is rust' }] },
  { label: 'Explain async/await', messages: [{ role: 'user', content: 'explain async await in javascript' }] },
  { label: 'What is a database index', messages: [{ role: 'user', content: 'what is a database index and when should I use one' }] },
  { label: 'REST vs GraphQL', messages: [{ role: 'user', content: 'REST vs GraphQL which should I use' }] },
  { label: 'How does DNS work', messages: [{ role: 'user', content: 'how does DNS work' }] },
  { label: 'What is WebSocket', messages: [{ role: 'user', content: 'what is a websocket and how is it different from http' }] },

  // --- Practical reasoning (screenshot-type failures) ---
  { label: 'Timezone question', messages: [{ role: 'user', content: 'what time is it in Tokyo right now if its 3pm in New York' }] },
  { label: 'Math question', messages: [{ role: 'user', content: 'what is 15% of 230' }] },
  { label: 'Unit conversion', messages: [{ role: 'user', content: 'how many kilometers is 50 miles' }] },
  { label: 'Day calculation', messages: [{ role: 'user', content: 'how many days between March 15 and June 1' }] },

  // --- URL-related (screenshot failure) ---
  { label: 'URL build request', messages: [{ role: 'user', content: 'take a look at https://example.com and build me something similar' }] },
  { label: 'URL explanation', messages: [{ role: 'user', content: 'what does this website do https://tailwindcss.com' }] },

  // --- Build requests ---
  { label: 'Build landing page', messages: [{ role: 'user', content: 'build me a landing page' }] },
  { label: 'Build todo app', messages: [{ role: 'user', content: 'build me a todo app' }] },
  { label: 'Build Next.js app', messages: [{ role: 'user', content: 'build a Next.js app' }] },
  { label: 'Build React dashboard', messages: [{ role: 'user', content: 'create a React dashboard with charts' }] },

  // --- Follow-ups ---
  {
    label: 'Corrective follow-up',
    messages: [
      { role: 'assistant', content: '**React:** React lets you build web pages from reusable components.' },
      { role: 'user', content: 'no I mean performance' },
    ],
  },
  {
    label: 'Compression: just decision',
    messages: [
      { role: 'assistant', content: '**Recommendation**\nI would go with React + Vite for the first release because it keeps iteration fast.\n\n**Next step**\nStart with the shared layout and one real message thread before adding advanced state.' },
      { role: 'user', content: 'Just the decision.' },
    ],
  },

  // --- General knowledge ---
  { label: 'What is machine learning', messages: [{ role: 'user', content: 'what is machine learning' }] },
  { label: 'Explain OAuth', messages: [{ role: 'user', content: 'explain oauth in simple terms' }] },
  { label: 'What is a container', messages: [{ role: 'user', content: 'what is a container in the context of software' }] },

  // --- Edge cases / potential misroutes ---
  { label: 'Weather question', messages: [{ role: 'user', content: 'what is the weather like today' }] },
  { label: 'Who are you', messages: [{ role: 'user', content: 'who are you' }] },
  { label: 'Tell me a joke', messages: [{ role: 'user', content: 'tell me a joke' }] },
  { label: 'Meaning of life', messages: [{ role: 'user', content: 'what is the meaning of life' }] },
  { label: 'Random chat', messages: [{ role: 'user', content: 'I had a great day today' }] },
  { label: 'Thank you', messages: [{ role: 'user', content: 'thanks' }] },
  { label: 'Yes', messages: [{ role: 'user', content: 'yes' }] },
  { label: 'No', messages: [{ role: 'user', content: 'no' }] },

  // --- Norwegian ---
  { label: 'Norwegian question', messages: [{ role: 'user', content: 'hva er docker' }] },
  { label: 'Norwegian explain', messages: [{ role: 'user', content: 'forklar python kort' }] },

  // --- Comparisons ---
  { label: 'React vs Vue', messages: [{ role: 'user', content: 'React vs Vue which is better for a new project' }] },
  { label: 'PostgreSQL vs MongoDB', messages: [{ role: 'user', content: 'PostgreSQL vs MongoDB for a SaaS app' }] },
  { label: 'Vite vs Webpack', messages: [{ role: 'user', content: 'should I use Vite or Webpack' }] },

  // --- SearXNG/search prompts ---
  { label: 'Current Node version', messages: [{ role: 'user', content: 'What is the current stable Node.js version right now?' }] },

  // --- Longer real prompts ---
  { label: 'Architecture advice', messages: [{ role: 'user', content: 'I want to build a chat application with real-time messaging, user authentication, and file sharing. What tech stack and architecture would you recommend?' }] },
  { label: 'Debug help', messages: [{ role: 'user', content: 'my React app keeps re-rendering and its slow what should I look at' }] },
  { label: 'Code review request', messages: [{ role: 'user', content: 'can you review my approach to error handling in a Node.js Express API' }] },

  // --- URL-based requests (screenshot failures) ---
  { label: 'URL rebuild GitHub', messages: [{ role: 'user', content: 'rebuild for me https://github.com/pingdotgg/lawn' }] },
  { label: 'URL look at GitHub', messages: [{ role: 'user', content: 'Take a look at https://github.com/pingdotgg/lawn' }] },

  // --- Personal statements ---
  { label: 'Personal intro Norway', messages: [{ role: 'user', content: 'I am from norway and I have been working on web development' }] },

  // --- General knowledge ---
  { label: 'Popular languages', messages: [{ role: 'user', content: 'what are the most popular programming languages' }] },
  { label: 'Philosophy meaning', messages: [{ role: 'user', content: 'what do philosophers say about the meaning of life' }] },

  // --- Conversation recall ---
  {
    label: 'First message recall',
    messages: [
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: 'Hi! How can I help?' },
      { role: 'user', content: 'what was the first message here?' },
    ],
  },

  // --- Follow-ups with context ---
  {
    label: 'Follow-up languages',
    messages: [
      { role: 'assistant', content: '**Programming** is the process of writing instructions for computers to execute.' },
      { role: 'user', content: 'what are the most popular languages' },
    ],
  },
  {
    label: 'Follow-up philosophers',
    messages: [
      { role: 'assistant', content: 'The meaning of life is a philosophical question that has been debated for millennia.' },
      { role: 'user', content: 'what do philosophers say about it' },
    ],
  },
];

async function main() {
  const results: { label: string; strategy: string; response: string; quality: string }[] = [];

  for (const { label, messages } of prompts) {
    try {
      const response = await engine.chat({ messages });
      const strategy = engine.lastResponseMeta?.strategy ?? 'unknown';
      const content = response.message.content;

      // Quality checks
      const issues: string[] = [];
      if (content.length < 10) issues.push('TOO_SHORT');
      if (content.length > 3000 && !/url-request|creative-code|scaffold|product-architecture/i.test(strategy)) issues.push('TOO_LONG');
      if (/youtube\.com|youtu\.be/i.test(content)) issues.push('YOUTUBE_LINK');
      if (/\byoutube\b/i.test(content) && !/youtube/i.test(messages[messages.length - 1].content)) issues.push('MENTIONS_YOUTUBE');
      if (/undefined|null|NaN|\[object/i.test(content)) issues.push('CODE_LEAK');
      if (/lorem ipsum/i.test(content)) issues.push('PLACEHOLDER');
      if (/I don't have access|I cannot|As an AI/i.test(content) && !/can't browse|can't check the weather|can't fetch|vai:v0 can/i.test(content)) issues.push('AI_REFUSAL');
      if (content === '') issues.push('EMPTY');
      // Check if response is generic build redirect when it shouldn't be
      if (/That's a build request/i.test(content) && !/build|create|make|design/i.test(messages[messages.length - 1].content)) {
        issues.push('FALSE_BUILD_REDIRECT');
      }

      const quality = issues.length === 0 ? 'OK' : issues.join(', ');
      results.push({ label, strategy, response: content, quality });

      // Print immediately
      console.log(`\n${'='.repeat(80)}`);
      console.log(`PROMPT: ${label}`);
      console.log(`INPUT:  ${messages[messages.length - 1].content}`);
      console.log(`STRATEGY: ${strategy}`);
      console.log(`QUALITY: ${quality}`);
      console.log(`${'─'.repeat(80)}`);
      console.log(content.slice(0, 500));
      if (content.length > 500) console.log(`... [${content.length - 500} more chars]`);
    } catch (err: any) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`PROMPT: ${label} — ERROR: ${err.message}`);
      results.push({ label, strategy: 'error', response: err.message, quality: 'ERROR' });
    }
  }

  // Summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('QUALITY SUMMARY');
  console.log(`${'='.repeat(80)}`);
  const good = results.filter((r) => r.quality === 'OK').length;
  const bad = results.filter((r) => r.quality !== 'OK');
  console.log(`TOTAL: ${results.length} | GOOD: ${good} | ISSUES: ${bad.length}`);
  if (bad.length > 0) {
    console.log('\nISSUES:');
    for (const r of bad) {
      console.log(`  ❌ ${r.label}: ${r.quality} (strategy: ${r.strategy})`);
    }
  }
}

main().catch(console.error);
