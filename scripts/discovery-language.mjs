/**
 * VAI Language & Stack Discovery — 20 questions with follow-ups
 * Topics: Norwegian grammar, English grammar, MERN/PERN/MEVN stacks
 * Each question gets a follow-up based on VAI's response
 */
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';

const questions = [
  // Norwegian grammar / language
  { q: "what is the past tense of the Norwegian verb 'å gå'", followUp: "can you conjugate 'å gå' in all tenses: present, past, future, and present perfect" },
  { q: "what is the correct Norwegian word order in a main clause", followUp: "what happens to word order in a Norwegian subordinate clause (bisetning)" },
  { q: "what are the three genders of Norwegian nouns (bokmål)", followUp: "give me an example noun for each gender with its definite form" },
  { q: "what is the difference between 'i' and 'på' in Norwegian prepositions", followUp: "when do you use 'hos' vs 'på' in Norwegian" },
  { q: "how do you write a formal email greeting in Norwegian", followUp: "what is the correct way to end a formal Norwegian email" },

  // English grammar / language
  { q: "what is the difference between present perfect and past simple in English", followUp: "when do you use 'have been' vs 'went' in English" },
  { q: "what is a dangling modifier in English grammar", followUp: "give me an example of a dangling modifier and how to fix it" },
  { q: "what is the difference between 'affect' and 'effect' in English", followUp: "use both 'affect' and 'effect' correctly in a sentence" },
  { q: "what are the 8 parts of speech in English", followUp: "what is the difference between an adverb and an adjective" },
  { q: "what is subject-verb agreement in English", followUp: "is it 'the team is' or 'the team are' in English" },

  // MERN stack
  { q: "what does MERN stack stand for", followUp: "what role does each technology play in the MERN stack" },
  { q: "what is the difference between MERN and PERN stack", followUp: "when would you choose PostgreSQL over MongoDB in a web stack" },
  { q: "what is Express.js used for in the MERN stack", followUp: "what is middleware in Express.js" },

  // MEVN stack
  { q: "what does MEVN stack stand for", followUp: "what is the difference between React and Vue.js in these stacks" },
  { q: "hva er forskjellen mellom MERN og MEVN stack", followUp: "hva er fordelene med Vue.js sammenlignet med React" },

  // Programming / web dev
  { q: "what is an ORM and give an example", followUp: "what is Prisma and how does it compare to Sequelize" },
  { q: "what is the difference between SQL and NoSQL databases", followUp: "when should you use MongoDB vs PostgreSQL" },
  { q: "what is REST API", followUp: "what is the difference between REST and GraphQL" },
  { q: "hva er en database migration", followUp: "hvorfor er database migrations viktig i et team-prosjekt" },
  { q: "what is the difference between server-side rendering and client-side rendering", followUp: "what is Next.js and how does it handle SSR" },
];

async function createConversation(title) {
  const res = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title }),
  });
  const data = await res.json();
  return data.id;
}

function askQuestion(conversationId, content) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ response: response || '[TIMEOUT]', status: response ? 'PARTIAL' : 'TIMEOUT' });
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text_delta') response += msg.textDelta;
        if (msg.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve({ response, status: 'OK' });
        }
      } catch {}
    });
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve({ response: '[ERROR]', status: 'ERROR' });
    });
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  VAI Language/Stack Discovery — 20 Q + Followup ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Health check
  const health = await fetch(`${BASE_URL}/health`).then(r => r.json());
  console.log(`Server: vocab=${health.stats.vocabSize}, knowledge=${health.stats.knowledgeEntries}\n`);

  const convId = await createConversation('Language & Stack Discovery');
  console.log(`Conversation: ${convId}\n`);

  const results = [];

  for (let i = 0; i < questions.length; i++) {
    const { q, followUp } = questions[i];
    console.log(`━━━ Q${(i + 1).toString().padStart(2, '0')}/20 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  QUESTION: ${q}`);

    // Ask main question
    const r1 = await askQuestion(convId, q);
    const preview1 = r1.response.replace(/\n/g, ' ').substring(0, 200);
    console.log(`  VAI [${r1.status}]: ${preview1}...`);

    // Classify quality
    const isRelevant1 = classifyResponse(q, r1.response);
    console.log(`  QUALITY: ${isRelevant1}`);

    // Ask follow-up
    console.log(`  FOLLOW-UP: ${followUp}`);
    const r2 = await askQuestion(convId, followUp);
    const preview2 = r2.response.replace(/\n/g, ' ').substring(0, 200);
    console.log(`  VAI [${r2.status}]: ${preview2}...`);

    const isRelevant2 = classifyResponse(followUp, r2.response);
    console.log(`  QUALITY: ${isRelevant2}`);

    // Conclusion
    const conclusion = (isRelevant1 === 'GOOD' && isRelevant2 === 'GOOD') ? 'KNOWS TOPIC'
      : (isRelevant1 === 'GOOD' || isRelevant2 === 'GOOD') ? 'PARTIAL'
      : 'NO KNOWLEDGE';
    console.log(`  ▸ CONCLUSION: ${conclusion}\n`);

    results.push({
      num: i + 1,
      question: q,
      response1: r1.response,
      quality1: isRelevant1,
      followUp,
      response2: r2.response,
      quality2: isRelevant2,
      conclusion,
    });
  }

  // Summary
  console.log('\n══════════════ DISCOVERY SUMMARY ══════════════');
  const knows = results.filter(r => r.conclusion === 'KNOWS TOPIC').length;
  const partial = results.filter(r => r.conclusion === 'PARTIAL').length;
  const none = results.filter(r => r.conclusion === 'NO KNOWLEDGE').length;
  console.log(`  KNOWS TOPIC: ${knows}/20`);
  console.log(`  PARTIAL:     ${partial}/20`);
  console.log(`  NO KNOWLEDGE: ${none}/20`);
  console.log('\n  Topics needing implementation:');
  results.filter(r => r.conclusion !== 'KNOWS TOPIC').forEach(r => {
    console.log(`    ❌ Q${r.num}: ${r.question} [${r.conclusion}]`);
  });

  // Write full results to file
  const fs = await import('fs');
  const output = results.map(r =>
    `Q${r.num}: ${r.question}\n` +
    `  R1 [${r.quality1}]: ${r.response1.substring(0, 500)}\n` +
    `  FOLLOW-UP: ${r.followUp}\n` +
    `  R2 [${r.quality2}]: ${r.response2.substring(0, 500)}\n` +
    `  CONCLUSION: ${r.conclusion}\n`
  ).join('\n---\n\n');
  fs.writeFileSync('scripts/discovery-language-results.txt', output);
  console.log('\nFull results saved to scripts/discovery-language-results.txt');
}

function classifyResponse(question, response) {
  if (!response || response === '[TIMEOUT]' || response === '[ERROR]') return 'NONE';
  const lower = response.toLowerCase();
  const qLower = question.toLowerCase();

  // Check for "couldn't find" / fallback responses
  if (/couldn't find a strong match|i don't have specific|i'm not sure/i.test(response)) return 'FALLBACK';

  // Check for generic VeggaAI intro (not relevant)
  if (/^(hey!?\s+)?i'?m\s+veggaai/i.test(response.trim()) && response.length < 200) return 'GENERIC';

  // Topic-specific relevance checks
  if (qLower.includes('norwegian') || qLower.includes('norsk') || qLower.includes('å gå') || qLower.includes('bokmål')) {
    if (/verb|tense|presens|preteritum|perfektum|gikk|går|gått|hankjønn|hunkjønn|intetkjønn|subjekt|leddsetning|bisetning/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('english') || qLower.includes('grammar') || qLower.includes('modifier') || qLower.includes('affect')) {
    if (/noun|verb|adjective|adverb|present|past|tense|modifier|subject|object|agreement/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('mern') || qLower.includes('pern') || qLower.includes('mevn')) {
    if (/mongo|express|react|node|postgres|vue|stack|database|frontend|backend/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('orm') || qLower.includes('prisma') || qLower.includes('sql')) {
    if (/orm|sequelize|prisma|database|query|schema|model|relation/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('rest') || qLower.includes('graphql') || qLower.includes('api')) {
    if (/endpoint|http|get|post|query|mutation|api|rest|graphql/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('ssr') || qLower.includes('rendering') || qLower.includes('next')) {
    if (/server|client|render|hydrat|next|ssr|csr|ssg/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('email') || qLower.includes('e-post')) {
    if (/hilsen|greeting|dear|formal|email|e-post|mvh|vennlig/i.test(response)) return 'GOOD';
  }
  if (qLower.includes('migration')) {
    if (/migra|schema|database|version|change|alter/i.test(response)) return 'GOOD';
  }

  // If response is substantial (>100 chars) and not a fallback, mark as MAYBE
  if (response.length > 100) return 'MAYBE';
  return 'NONE';
}

main().catch(console.error);
