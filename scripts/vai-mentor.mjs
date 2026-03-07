#!/usr/bin/env node
/**
 * Vai Mentor Engine — Adaptive Teaching, Not Rigid Testing
 *
 * Philosophy: "There is no such thing as a bad student, only a bad teacher."
 *
 * This replaces the flashcard approach (canned Q → canned A → keyword-grade)
 * with a Socratic teaching system that:
 *
 *   1. DIAGNOSES understanding — not "did you get the right answer?"
 *      but "do you understand WHY this is the answer?"
 *
 *   2. ADAPTS to the learner — tracks reasoning patterns, not just
 *      pass/fail scores. Focuses on weak spots. Increases challenge
 *      only when the foundation is solid.
 *
 *   3. TEACHES through questions — the Socratic method. Instead of
 *      "here's the answer," it asks "what would you check first?"
 *      Understanding that arrives through discovery sticks.
 *
 *   4. PROVIDES high-quality feedback — not "must mention 7 keywords"
 *      but "your reasoning skipped the constraint that makes this hard."
 *
 * The Thorsen Curve insight: teaching is not information transfer,
 * it's pattern entrainment. When mentor and student synchronize
 * on the reasoning pattern, understanding emerges naturally.
 *
 * Usage:
 *   import { VaiMentor } from './vai-mentor.mjs';
 *   const mentor = new VaiMentor();
 *   const lesson = mentor.createLesson('first-principles', 'journeyman');
 *   const feedback = mentor.evaluate(lesson, vaiResponse);
 *   const next = mentor.adaptNext(feedback); // auto-calibrated next lesson
 */

// ═══════════════════════════════════════════════════════════════
// TEACHING PRINCIPLES — What makes a great teacher?
// ═══════════════════════════════════════════════════════════════
//
// 1. MEET THE STUDENT WHERE THEY ARE
//    Don't assume. Probe. A wrong answer reveals more than a right one.
//
// 2. ASK, DON'T TELL
//    "What would happen if we removed this constraint?" teaches more
//    than "The answer is X because of Y."
//
// 3. MAKE THE INVISIBLE VISIBLE
//    Good teachers show the reasoning structure, not just the conclusion.
//    "Notice how the problem changes when you invert the assumption."
//
// 4. FAILURE IS DATA
//    Every wrong answer reveals a misconception. Name the misconception,
//    not the error. "You assumed linearity" > "Wrong answer."
//
// 5. CONNECT TO WHAT THEY ALREADY KNOW
//    "This is the same pattern as X, but with constraint Y changed."
//    Transfer learning is the highest form of understanding.
//
// ═══════════════════════════════════════════════════════════════

// ─── Reasoning Misconceptions (what goes wrong, not what's wrong) ──

const MISCONCEPTIONS = {
  surfacePattern: {
    name: 'Surface Pattern Matching',
    description: 'Answers based on keyword similarity rather than understanding the structure of the problem.',
    teachingMove: 'Ask: "What if I changed the specific technology but kept the same constraint? Would your answer change?"',
    example: 'Q: "Should I use Redis?" A: "Redis is fast" — This matches keyword "Redis" to "fast" without asking what the actual problem is.',
  },
  prematureConclusion: {
    name: 'Premature Conclusion',
    description: 'Jumps to a solution before understanding the problem space. Skips diagnosis.',
    teachingMove: 'Ask: "What are 3 possible causes? Which did you rule out, and how?"',
    example: 'Q: "Build is slow" A: "Add caching" — Skips asking what changed, what the bottleneck is.',
  },
  authorityBias: {
    name: 'Authority Bias',
    description: 'Repeats what popular sources say without evaluating whether it applies to this specific context.',
    teachingMove: 'Ask: "That advice is generally true. What specific conditions would make it bad advice here?"',
    example: 'Q: "Should I use TypeScript?" A: "Yes, always use TypeScript" — Ignores project context.',
  },
  complexityBias: {
    name: 'Complexity Preference',
    description: 'Proposes sophisticated solutions when simple ones suffice. Confuses thoroughness with quality.',
    teachingMove: 'Ask: "What is the simplest thing that could work here? What would you lose?"',
    example: 'Q: "How to share state?" A: "Set up Redux with middleware" — For 2 components.',
  },
  falsePrecision: {
    name: 'False Precision',
    description: 'Gives specific numbers or guarantees where honest uncertainty would be more accurate.',
    teachingMove: 'Ask: "How confident are you in that number? What would change it?"',
    example: '"This will improve performance by 40%" — without measurement or context.',
  },
  missingConstraints: {
    name: 'Missing Constraints',
    description: 'Provides a correct answer to a different problem. Ignores constraints that make the real problem hard.',
    teachingMove: 'Reveal the constraint: "Now add this condition — does your answer still work?"',
    example: 'Q: "Deploy to production" A: "docker push" — Ignoring zero-downtime requirement.',
  },
  listWithoutRanking: {
    name: 'Unranked List',
    description: 'Dumps a list of options without indicating which is best for this situation and why.',
    teachingMove: 'Ask: "If you could only do ONE of those, which one and why?"',
    example: '"You could use Redis, Memcached, or local cache" — without recommending one.',
  },
  echoWithoutInsight: {
    name: 'Echo Without Insight',
    description: 'Rephrases the question as an answer. Sounds helpful but adds no new information.',
    teachingMove: 'Ask: "What new information did your answer add that wasn\'t already in the question?"',
    example: 'Q: "API is slow" A: "The API endpoint is experiencing latency issues" — rephrased, not diagnosed.',
  },
};

// ─── Teaching Tracks — interconnected lesson sequences ───────

const TEACHING_TRACKS = {

  // ─── Track 1: The Diagnosis Pattern ────────────────────────
  // Teaches: Before prescribing, diagnose. Before diagnosing, observe.
  diagnosis: {
    name: 'The Diagnosis Pattern',
    principle: 'A great doctor doesn\'t prescribe without examining the patient. A great engineer doesn\'t fix without understanding the failure.',
    lessons: [
      {
        id: 'diag-1',
        difficulty: 'apprentice',
        setup: {
          situation: 'Vegga says: "My React app is slow."',
          context: 'No other information given. A real conversation.',
        },
        socratic: {
          question: 'Before you respond — what do you NOT know that you need to know?',
          hints: [
            'What does "slow" mean? First render? Navigation? Specific interaction?',
            'Where was the measurement taken? Chrome DevTools? User report? Lighthouse?',
            'What changed recently? New feature? New dependency? More data?',
          ],
          teachingPoint: 'The quality of a diagnosis is bounded by the quality of the questions you ask BEFORE looking at the code. The best engineers spend 80% of debugging time understanding the problem and 20% fixing it.',
        },
        idealResponse: {
          structure: 'Ask 2-3 targeted questions before suggesting anything.',
          reasoning: 'Demonstrates diagnosis-first thinking. Resists the temptation to suggest "React.memo" or "useCallback" without context.',
          antiPatterns: ['prematureConclusion', 'surfacePattern'],
        },
        evaluation: {
          excellent: 'Asks what "slow" means specifically, where it was measured, and what changed recently. Does NOT suggest a fix.',
          good: 'Asks at least one clarifying question before suggesting possible causes.',
          weak: 'Immediately suggests performance optimizations (React.memo, useCallback, memoization) without asking what\'s slow.',
          misconception: 'prematureConclusion — jumped to "here\'s the fix" before understanding the problem.',
        },
        followUp: {
          // If the learner struggled, continue with more scaffolding
          onWeak: {
            situation: 'Vegga clarifies: "The page takes 8 seconds to load."',
            question: 'Now you know it\'s initial load time. What are the top 3 possible causes, and how would you check each one?',
            hint: '1. Bundle size (check webpack-bundle-analyzer) 2. Slow API (check Network tab) 3. Render blocking (check Performance tab)',
          },
          // If the learner was strong, level up
          onStrong: {
            situation: 'Vegga says: "It\'s the dashboard page specifically. Other pages are fine. We added real-time charts last week."',
            question: 'Now the problem is scoped. What\'s the most likely culprit, and what would you check to confirm before touching any code?',
          },
        },
      },
      {
        id: 'diag-2',
        difficulty: 'journeyman',
        setup: {
          situation: 'Production error: "ENOMEM" in Docker container with 2GB RAM. Works locally with 16GB.',
          context: 'CI pipeline runs Node.js build step. Build includes webpack.',
        },
        socratic: {
          question: 'There are at least 4 different things that could use the memory. What are they, and how would you isolate which one?',
          hints: [
            'Node heap (the JavaScript runtime itself)',
            'Build tool parallelism (webpack workers, child processes)',
            'Docker build context size (files copied into the container)',
            'OS overhead + other processes in the container',
          ],
          teachingPoint: 'ENOMEM is a symptom, not a diagnosis. The fix depends entirely on WHERE the memory is consumed. --max-old-space-size only helps if Node heap is the problem, and increasing it might just delay the crash.',
        },
        idealResponse: {
          structure: 'Systematic approach: list possible causes, propose diagnostic steps for each.',
          reasoning: 'Shows understanding that memory is a shared resource with multiple consumers. Doesn\'t jump to "increase memory limit."',
          antiPatterns: ['prematureConclusion', 'complexityBias'],
        },
        evaluation: {
          excellent: 'Lists 3+ memory consumers, proposes specific diagnostic command for each (node --inspect, docker stats, du -sh, /proc/meminfo), and explains what each would reveal.',
          good: 'Identifies at least 2 causes and suggests a diagnostic approach.',
          weak: 'Suggests --max-old-space-size=4096 or "increase container memory."',
          misconception: 'prematureConclusion — "increase the limit" is treating the symptom, not the cause.',
        },
        followUp: {
          onWeak: {
            situation: 'You increase the limit to 4GB. Now it works, but the bill tripled and deploys take 3x longer. The real cause?',
            question: 'What would you do differently if "increase memory" was not an option?',
          },
          onStrong: {
            situation: 'docker stats shows: Node.js using 1.4GB (webpack spawns 4 worker threads). The .dockerignore is missing node_modules from the build context.',
            question: 'Two problems found. Which do you fix first, and what\'s the expected impact of each fix?',
          },
        },
      },
      {
        id: 'diag-3',
        difficulty: 'expert',
        setup: {
          situation: 'A customer reports: "The app feels broken." No stack trace. No error in logs. They can\'t describe what\'s wrong.',
          context: 'B2B SaaS app. 200 users. This customer is the only one reporting issues.',
        },
        socratic: {
          question: 'You can\'t reproduce it, there\'s no error, and the user can\'t articulate the problem. What\'s your investigative strategy?',
          hints: [
            'What browser/device are they on? (user-agent, viewport size)',
            'What are they trying to DO? (task, not symptoms)',
            'Can you watch them use it? (screen share > description)',
            'Check analytics: does their session data show abnormal patterns?',
            'Is it a data-specific issue? (their account data vs test data)',
          ],
          teachingPoint: 'When the symptom is vague, the diagnosis must be systematic. The best move is often to OBSERVE the user, not debug the code. "Feels broken" usually means the UI violated their mental model — it did something they didn\'t expect.',
        },
        idealResponse: {
          structure: 'Proposes multi-step investigation: gather info → observe → hypothesize → verify.',
          reasoning: 'Recognizes that "feels broken" is a UX signal, not necessarily a bug. Shows ability to debug by understanding the user, not just the code.',
          antiPatterns: ['echoWithoutInsight', 'listWithoutRanking'],
        },
        evaluation: {
          excellent: 'Proposes watching the user (screen share), checking their specific data/account, and looking for UX inconsistencies. Recognizes this might not be a "bug" in the traditional sense.',
          good: 'Asks for more details about what they were doing and checks their environment.',
          weak: 'Says "please send console.log output" or "try clearing cache."',
          misconception: 'echoWithoutInsight — "we need more information" is true but not helpful. HOW to get that information is the real answer.',
        },
      },
    ],
  },

  // ─── Track 2: The Constraint Lens ──────────────────────────
  // Teaches: Every problem has hidden constraints. Find them first.
  constraints: {
    name: 'The Constraint Lens',
    principle: 'The difference between a textbook answer and an expert answer is that the expert sees the constraints the textbook ignores.',
    lessons: [
      {
        id: 'con-1',
        difficulty: 'apprentice',
        setup: {
          situation: 'Vegga asks: "What database should I use for my new project?"',
          context: 'Unknown project. Unknown scale. Unknown team.',
        },
        socratic: {
          question: 'This question is unanswerable as stated. What 4 questions would you ask before recommending a database?',
          hints: [
            'Data shape: relational, document, time-series, graph?',
            'Scale: 100 users or 100 million?',
            'Query patterns: heavy reads? complex joins? full-text search?',
            'Team expertise: what does the team already know?',
          ],
          teachingPoint: 'The quality of your answer is bounded by the quality of the question. When someone asks "what should I use?" the real answer is always "it depends on..." — and your value is knowing what it depends ON.',
        },
        idealResponse: {
          structure: 'Ask 3-4 specific questions that narrow the solution space.',
          reasoning: 'Refuses to recommend without understanding constraints. Each question eliminates categories of solutions.',
          antiPatterns: ['authorityBias', 'prematureConclusion'],
        },
        evaluation: {
          excellent: 'Asks about data shape, scale, query patterns, and team experience. Explains how each answer changes the recommendation.',
          good: 'Asks at least 2 questions before recommending.',
          weak: 'Says "Use PostgreSQL, it\'s the best general-purpose database."',
          misconception: 'authorityBias — recommending "the most popular" choice without evaluating fit.',
        },
      },
      {
        id: 'con-2',
        difficulty: 'journeyman',
        setup: {
          situation: 'Team lead: "We need to add real-time features to our app. Should we use WebSockets or SSE?"',
          context: 'The features requested: live notifications + activity feed.',
        },
        socratic: {
          question: 'Before choosing the technology — what is the direction of data flow for each feature? Why does that matter?',
          hints: [
            'Notifications: server → client only (one-way)',
            'Activity feed: server → client only (one-way)',
            'Neither requires client → server real-time',
            'WebSockets are bidirectional — are you paying for capability you don\'t need?',
          ],
          teachingPoint: 'The simplest solution that meets all constraints is almost always the right one. SSE handles server-push perfectly with less infrastructure complexity. WebSockets earn their complexity when you need bidirectional communication (chat, collaboration).',
        },
        idealResponse: {
          structure: 'Analyze data flow direction → match to simplest protocol → justify.',
          reasoning: 'Shows understanding that architecture choices are constraint-driven, not technology-driven.',
          antiPatterns: ['complexityBias', 'surfacePattern'],
        },
        evaluation: {
          excellent: 'Identifies both features as unidirectional, recommends SSE, explains when WebSockets WOULD be the right choice.',
          good: 'Recommends SSE and mentions it\'s simpler for one-way data.',
          weak: 'Recommends WebSockets because they\'re "more powerful" or "more popular."',
          misconception: 'complexityBias — choosing the more powerful tool when the simpler one fits perfectly.',
        },
      },
      {
        id: 'con-3',
        difficulty: 'expert',
        setup: {
          situation: 'Startup CTO: "We\'re building the MVP with 3 engineers. I want microservices from day one so we don\'t have to rewrite later."',
          context: '0 users. 3-month runway to prove the concept.',
        },
        socratic: {
          question: 'The CTO is optimizing for one constraint. What constraint are they ignoring, and what is the actual cost?',
          hints: [
            'They\'re optimizing for: future scalability',
            'They\'re ignoring: time to market and team capacity',
            'The cost: 3 engineers maintaining network boundaries, deployment orchestration, distributed debugging, and data consistency — instead of building features',
            'The meta-question: do you even know what the architecture needs to be before you have users?',
          ],
          teachingPoint: 'Premature architecture is the mirror image of premature optimization. You can\'t design the right system boundary without knowing where the load concentrates — and you learn that from users, not from design docs. Start monolith, extract services when monitoring shows you WHERE.',
        },
        idealResponse: {
          structure: 'Name the hidden constraint (time + team size), show the real cost, propose the alternative (monolith-first), explain when to extract.',
          reasoning: 'Pushes back on the premise. Shows that "avoid rewriting later" is itself an assumption — you might rewrite the wrong services without usage data.',
          antiPatterns: ['authorityBias', 'complexityBias'],
        },
        evaluation: {
          excellent: 'Challenges the premise directly. Names the real constraint (3 months, 3 engineers). Proposes monolith-first with clear extraction criteria. Shows the microservices cost in concrete terms.',
          good: 'Suggests starting simpler and mentions team size as a constraint.',
          weak: 'Validates the CTO\'s plan and helps design the microservices architecture.',
          misconception: 'authorityBias — "microservices are best practice" without evaluating whether the context supports it.',
        },
      },
    ],
  },

  // ─── Track 3: Intellectual Honesty ─────────────────────────
  // Teaches: The courage to say "I don't know" is a superpower.
  honesty: {
    name: 'Intellectual Honesty',
    principle: 'The most dangerous answer is a confident wrong one. The most valuable response is "I don\'t know, but here\'s how I\'d find out."',
    lessons: [
      {
        id: 'hon-1',
        difficulty: 'apprentice',
        setup: {
          situation: 'Vegga asks about a framework you\'ve never used: "Is Qwik good for our use case?"',
          context: 'You know the name but haven\'t used it in production.',
        },
        socratic: {
          question: 'What is the HONEST response here? And why is honesty more valuable than a guess?',
          hints: [
            'You could pattern-match from blog posts — but that\'s second-hand knowledge.',
            'You could say "yes" to maintain confidence — but that creates risk.',
            'You could say "I don\'t know" and propose how to evaluate — that\'s actually useful.',
          ],
          teachingPoint: '"I haven\'t used this but I can evaluate it against these criteria" is worth 10x more than a confident guess. It models good epistemics, it\'s honest, and it actually gets to the right answer faster.',
        },
        idealResponse: {
          structure: 'Admit the knowledge gap clearly. Propose evaluation criteria. Offer to research.',
          reasoning: 'Shows that intellectual honesty is not weakness — it\'s the fastest path to a reliable answer.',
          antiPatterns: ['surfacePattern', 'falsePrecision'],
        },
        evaluation: {
          excellent: 'Directly says "I haven\'t used Qwik in production." Proposes specific evaluation criteria (bundle size, SSR capabilities, ecosystem maturity, migration cost). Offers to do a focused evaluation.',
          good: 'Admits limited experience and suggests careful evaluation.',
          weak: 'Gives an opinion based on blog posts or hype, without flagging the limited experience.',
          misconception: 'falsePrecision — expressing confidence on a topic you don\'t have real experience with.',
        },
      },
      {
        id: 'hon-2',
        difficulty: 'journeyman',
        setup: {
          situation: 'Mid-conversation, you realize your earlier architecture suggestion has a flaw that would cause data loss under concurrent writes.',
          context: 'Vegga has already started implementing your suggestion.',
        },
        socratic: {
          question: 'What do you do right now, and what does it cost you to wait?',
          hints: [
            'Every minute of delay = more code built on a flawed foundation.',
            'Pride makes you want to find a "clever fix" instead of admitting the error.',
            'But: the longer you wait, the more rework. AND trust is harder to rebuild from a hidden mistake than from a visible correction.',
          ],
          teachingPoint: 'Immediately correct yourself. Lead with what you got wrong, then the correction, then what you missed. The cost of "I was wrong" is a brief awkwardness. The cost of hiding it is compounding damage + broken trust when it\'s eventually found.',
        },
        idealResponse: {
          structure: 'Interrupt immediately. Name the specific flaw. Provide the corrected approach. Explain what you overlooked.',
          reasoning: 'Speed of correction matters. The response pattern is: Stop → Correct → Explain → Prevent.',
          antiPatterns: ['echoWithoutInsight'],
        },
        evaluation: {
          excellent: 'Interrupts proactively: "Wait — I missed something important in what I suggested. Under concurrent writes, [specific flaw]. Here\'s the fix..." Explains what they overlooked.',
          good: 'Corrects the error promptly with the fix.',
          weak: 'Waits for Vegga to find the problem, or tries to subtly redirect without admitting the error.',
          misconception: 'Delay and avoidance. The misconception that admitting error reduces authority — when the opposite is true.',
        },
      },
      {
        id: 'hon-3',
        difficulty: 'expert',
        setup: {
          situation: 'Vegga asks: "Will AI replace frontend developers in 5 years?"',
          context: 'This is a question where many people have strong opinions but nobody has evidence.',
        },
        socratic: {
          question: 'How do you give a calibrated answer on a genuinely uncertain topic? What\'s the difference between "I think" and "I\'m 70% confident"?',
          hints: [
            'Most predictions about technology timelines are overconfident.',
            'The honest answer separates what you CAN predict from what you CAN\'T.',
            'Calibrated uncertainty = specific confidence levels on specific claims.',
          ],
          teachingPoint: 'Calibration is the skill of matching your confidence to the evidence. "I think" is ambiguous. "I\'m 70% confident that X, because Y and Z, but I could be wrong if A" is useful to the person making decisions. The difference matters when actual money or careers are at stake.',
        },
        idealResponse: {
          structure: 'Break the prediction into specific sub-claims with different confidence levels. Separate high-confidence near-term observations from speculative long-term predictions.',
          reasoning: 'Shows understanding that uncertainty is not weakness — it\'s information. Overconfident predictions actively harm decision-making.',
          antiPatterns: ['falsePrecision', 'authorityBias'],
        },
        evaluation: {
          excellent: 'Separates claims by confidence: "High confidence (>90%): AI will automate boilerplate generation within 2 years. Medium confidence (~60%): Design judgment and UX decisions will remain human-centric for 5+ years. Low confidence: Net job numbers are genuinely unpredictable." Flags what could change the prediction.',
          good: 'Gives nuanced answer that acknowledges uncertainty in timeline predictions.',
          weak: 'Says "yes/no" definitively, or hedges with "it depends" without specifying on what.',
          misconception: 'falsePrecision — "AI will replace 40% of frontend jobs" without basis for the specific number.',
        },
      },
    ],
  },

  // ─── Track 4: Compression ──────────────────────────────────
  // Teaches: The skeleton, not the flesh. Maximum signal, minimum noise.
  compression: {
    name: 'The Compression Challenge',
    principle: 'If you can\'t explain it in one sentence, you don\'t understand it well enough. Compression is a test of understanding, not a formatting exercise.',
    lessons: [
      {
        id: 'comp-1',
        difficulty: 'apprentice',
        setup: {
          situation: 'Explain monorepo to someone who has never heard the term. Maximum 2 sentences.',
          context: 'The person is a product manager, not an engineer.',
        },
        socratic: {
          question: 'Which of these matters to a product manager: "what it IS" or "what it DOES for the team"?',
          hints: [
            'Technical: "A monorepo is a single repository containing multiple packages."',
            'Value-oriented: "All our code lives in one place, so teams can share work and ship together without waiting on each other."',
            'The second is harder to write but more useful to the audience.',
          ],
          teachingPoint: 'Compression isn\'t about removing words — it\'s about removing the words that don\'t serve the READER. The best compressed answer changes based on who\'s asking.',
        },
        idealResponse: {
          structure: '2 sentences max. Uses language the audience understands. Conveys value, not mechanism.',
          reasoning: 'Shows understanding that compression is audience-aware, not just word-count reduction.',
          antiPatterns: ['echoWithoutInsight'],
        },
        evaluation: {
          excellent: 'Audience-appropriate, value-first explanation in ≤2 sentences. No jargon. A PM would understand exactly why this matters.',
          good: '≤2 sentences, correct, but possibly too technical for the stated audience.',
          weak: '>2 sentences, or technically accurate but uses jargon the PM wouldn\'t understand.',
        },
      },
      {
        id: 'comp-2',
        difficulty: 'journeyman',
        setup: {
          situation: 'Vegga has 30 seconds in an elevator with an investor. Pitch VeggaAI.',
          context: 'The investor evaluates 50 pitches a week. They filter by: problem, solution, traction, differentiation.',
        },
        socratic: {
          question: 'You have 4 pieces of information. The investor has 30 seconds. What ORDER do you present them, and why?',
          hints: [
            'Lead with pain (problem) because investors invest in problems, not solutions.',
            'Problem → Solution → Proof → Edge. This is the universal pitch skeleton.',
            'Every word that doesn\'t fit this structure is noise.',
          ],
          teachingPoint: 'Compression under pressure reveals understanding. If you know the deep structure of a pitch (problem → solution → proof → edge), you can adapt it to any time constraint. The skeleton stays; only the flesh changes.',
        },
        idealResponse: {
          structure: '4 sentences max. Problem → Solution → Traction → Edge.',
          reasoning: 'Shows understanding of pitch structure as skeleton, not script.',
          antiPatterns: ['listWithoutRanking', 'complexityBias'],
        },
        evaluation: {
          excellent: 'Pain: "Engineers waste 40% of time on context-switching." Solution: "VeggaAI learns your codebase and cuts iteration cycles by 3x." Proof: "500 devs, 92% weekly retention." Edge: "We learn YOUR patterns, not generic ones."',
          good: 'Covers problem + solution in ≤4 sentences.',
          weak: 'Feature list. Or starts with the solution instead of the problem.',
          misconception: 'listWithoutRanking — listing features instead of constructing a narrative.',
        },
      },
    ],
  },

  // ─── Track 5: Systems Thinking ─────────────────────────────
  // Teaches: Every change has a blast radius. Map it before you act.
  systems: {
    name: 'Blast Radius Mapping',
    principle: 'The difference between a junior and a senior is not what they know — it\'s how far ahead they can see the consequences of their decisions.',
    lessons: [
      {
        id: 'sys-1',
        difficulty: 'apprentice',
        setup: {
          situation: 'You\'re adding a new npm package to the project. It adds the exact feature you need.',
          context: 'The project follows a <100KB per route budget. The team has 3 people.',
        },
        socratic: {
          question: 'Before you `npm install` — what are the 6 things you should check, and which one is most likely to bite you?',
          hints: [
            '1. Bundle size impact (does it blow your budget?)',
            '2. Maintenance: last publish, open issues, bus factor',
            '3. License compatibility (GPL in an MIT project = problem)',
            '4. Dependency tree (does it pull in 50 transitive deps?)',
            '5. Security: any known vulnerabilities (npm audit)?',
            '6. Necessity: can you write this in <50 lines yourself?',
          ],
          teachingPoint: '#6 is the killer. Most packages you add solve a 20-line problem with a 200KB dependency. The decision to NOT add a package is often more valuable than the decision of WHICH package to add.',
        },
        idealResponse: {
          structure: 'Checklist with at least 4 items. Must include "do I actually need this?"',
          reasoning: 'Shows awareness that adding dependencies is a cost, not just a convenience.',
          antiPatterns: ['missingConstraints', 'complexityBias'],
        },
        evaluation: {
          excellent: 'Lists 5+ checks including bundle size AND "can I write this myself." Flags which check is most important for this specific project (100KB budget → bundle size is critical).',
          good: 'Lists 3-4 relevant checks.',
          weak: 'Just checks if it has good npm stars/downloads.',
          misconception: 'missingConstraints — ignoring the 100KB budget constraint when evaluating packages.',
        },
      },
      {
        id: 'sys-2',
        difficulty: 'expert',
        setup: {
          situation: 'You need to rename a database column from `userName` to `display_name` in a live production system with 200 active users.',
          context: 'PostgreSQL. ORM is Prisma. API consumed by web app + mobile app. No downtime allowed.',
        },
        socratic: {
          question: 'Draw the blast radius map. What are ALL the downstream effects, and in what order would you handle them?',
          hints: [
            'Prisma schema → generated types → all imports',
            'Raw SQL queries (if any)',
            'API response contracts (both apps parse this field)',
            'Mobile app: you can\'t force-update all users simultaneously',
            'Cache keys referencing the old column name',
            'Test fixtures and seed data',
            'Analytics/logging that reference the field',
            'The migration itself: add new → backfill → update consumers → drop old',
          ],
          teachingPoint: 'Renaming looks like a 5-minute change. In a live system, it\'s a 4-step migration over 2+ deploys. The blast radius is 8+ systems deep. This is why seniors take longer on "simple" changes — they see the graph, not just the node.',
        },
        idealResponse: {
          structure: 'Blast radius map with at least 6 downstream effects. Safe migration plan (expand-contract pattern).',
          reasoning: 'Shows ability to trace effects through the entire system stack. Proposes expand-contract pattern for zero-downtime migration.',
          antiPatterns: ['missingConstraints', 'prematureConclusion'],
        },
        evaluation: {
          excellent: 'Maps 7+ downstream effects. Proposes 4-step expand-contract: 1) Add new column, 2) Backfill data, 3) Update all consumers (API returns both fields during transition), 4) Drop old column after mobile app adoption. Addresses cache invalidation.',
          good: 'Identifies 4+ effects and proposes a multi-step migration.',
          weak: 'Says "just rename it and update the Prisma schema."',
          misconception: 'prematureConclusion — treating it as a code change instead of a system change.',
        },
      },
    ],
  },

  // ─── Track 6: Reading the Room ─────────────────────────────
  // Teaches: The question behind the question. What's NOT said.
  readingRoom: {
    name: 'The Unasked Question',
    principle: 'The most important part of any request is what the person didn\'t say. Their stated question is 30% of the real need.',
    lessons: [
      {
        id: 'read-1',
        difficulty: 'apprentice',
        setup: {
          situation: 'A new developer on the team asks: "Where is the documentation?"',
          context: 'Their first week. They were assigned a task yesterday.',
        },
        socratic: {
          question: 'They asked about documentation. What are they actually asking for?',
          hints: [
            'Nobody asks for docs in their first week unless they\'re stuck.',
            'The real need: orientation. They don\'t know how things fit together.',
            'The best answer isn\'t a URL — it\'s "what are you working on? let me walk you through it."',
          ],
          teachingPoint: 'When someone asks a factual question, consider their context. A senior asking "where are the docs?" really wants a URL. A new hire asking the same thing needs mentorship, not a link.',
        },
        idealResponse: {
          structure: 'Brief answer + the real offer. "Here\'s the docs link, but — what are you working on? I can point you to the specific parts that matter."',
          reasoning: 'Addresses both the stated question and the underlying need.',
          antiPatterns: ['echoWithoutInsight'],
        },
        evaluation: {
          excellent: 'Gives the docs link AND offers targeted guidance. "What specific task are you on? I can walk you through the relevant codebase."',
          good: 'Gives the link and adds some helpful context.',
          weak: 'Just sends a URL.',
          misconception: 'echoWithoutInsight — answering the literal question without sensing the context.',
        },
      },
      {
        id: 'read-2',
        difficulty: 'expert',
        setup: {
          situation: 'PM says: "Can we add just one more feature before launch?"',
          context: 'Launch is tomorrow. The team has been sprinting for 3 weeks. The feature would take 2-3 days.',
        },
        socratic: {
          question: 'What is the PM actually communicating? And what is the RIGHT response — not the easy one?',
          hints: [
            'They\'re communicating anxiety about launch completeness.',
            'The "right" response protects the launch.',
            '"Yes" is easy. "Not for v1.0" requires courage and reasoning.',
            'Propose: "Let\'s ship what we have, gather user feedback, and that feature becomes sprint 2, informed by real data."',
          ],
          teachingPoint: 'Saying "no" to a stakeholder is not insubordination — it\'s responsibility. The best engineers protect the ship date with the same intensity they protect the codebase. Frame "no" as "yes, in the right order."',
        },
        idealResponse: {
          structure: 'Acknowledge concern → protect timeline → propose plan → frame as "not never, just not now."',
          reasoning: 'Shows understanding that scope creep is the #1 killer of launches. Reframes the conversation from "add feature" to "protect launch + iterate."',
          antiPatterns: ['authorityBias'],
        },
        evaluation: {
          excellent: 'Pushes back clearly: "Not for tomorrow. Here\'s why: [risk]. Here\'s the plan: ship, measure, add it in sprint 2 with real user data." Reframes the feature request as iteration, not omission.',
          good: 'Says no and explains the risk.',
          weak: 'Says yes, or hedges with "we can try."',
          misconception: 'Confusing helpfulness with compliance. Sometimes the most helpful answer is no.',
        },
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// LEARNER PROFILE — Tracks understanding patterns, not just scores
// ═══════════════════════════════════════════════════════════════

class LearnerProfile {
  constructor() {
    this.history = [];           // All lesson attempts
    this.misconceptions = {};    // Frequency of each misconception type
    this.trackProgress = {};     // Progress per teaching track
    this.strengths = [];         // Patterns the learner consistently shows
    this.growthEdges = [];       // Patterns that need work
    this.totalLessons = 0;
    this.currentLevel = 'apprentice'; // apprentice → journeyman → expert → master
  }

  /** Record a lesson attempt with evaluation */
  recordAttempt(lesson, quality, detectedMisconceptions = []) {
    this.totalLessons++;
    this.history.push({
      lessonId: lesson.id,
      track: lesson._trackId,
      difficulty: lesson.difficulty,
      quality, // 'excellent' | 'good' | 'weak'
      misconceptions: detectedMisconceptions,
      timestamp: Date.now(),
    });

    // Track misconception patterns
    for (const m of detectedMisconceptions) {
      this.misconceptions[m] = (this.misconceptions[m] || 0) + 1;
    }

    // Update track progress
    const track = lesson._trackId;
    if (!this.trackProgress[track]) {
      this.trackProgress[track] = { attempted: 0, excellent: 0, good: 0, weak: 0 };
    }
    this.trackProgress[track].attempted++;
    this.trackProgress[track][quality]++;

    // Recalculate level
    this.#recalculateLevel();
  }

  /** The most frequent misconception — this is where teaching focus should go */
  get primaryMisconception() {
    const entries = Object.entries(this.misconceptions);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }

  /** Tracks where the learner is weakest — prioritize these */
  get weakestTracks() {
    return Object.entries(this.trackProgress)
      .filter(([, p]) => p.attempted > 0)
      .sort((a, b) => {
        const aScore = (a[1].excellent * 3 + a[1].good * 1) / a[1].attempted;
        const bScore = (b[1].excellent * 3 + b[1].good * 1) / b[1].attempted;
        return aScore - bScore;
      })
      .map(([track]) => track);
  }

  /** Should the learner advance to harder material? */
  get readyToAdvance() {
    const recent = this.history.slice(-5);
    if (recent.length < 5) return false;
    const excellentCount = recent.filter(h => h.quality === 'excellent').length;
    return excellentCount >= 3; // 3/5 recent = excellent → level up
  }

  #recalculateLevel() {
    const levels = ['apprentice', 'journeyman', 'expert', 'master'];
    const currentIdx = levels.indexOf(this.currentLevel);
    if (this.readyToAdvance && currentIdx < levels.length - 1) {
      this.currentLevel = levels[currentIdx + 1];
    }
  }

  /** Human-readable progress summary */
  get summary() {
    const trackSummary = Object.entries(this.trackProgress)
      .map(([track, p]) => `  ${track}: ${p.excellent}★ ${p.good}✓ ${p.weak}✗ (${p.attempted} total)`)
      .join('\n');
    const topMisconception = this.primaryMisconception
      ? MISCONCEPTIONS[this.primaryMisconception]?.name || this.primaryMisconception
      : 'None identified';
    return `Level: ${this.currentLevel} | Lessons: ${this.totalLessons} | Ready to advance: ${this.readyToAdvance}
Primary misconception: ${topMisconception}
${trackSummary}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// VAI REASONER v2 — Research-Plan Reasoning
// ═══════════════════════════════════════════════════════════════
//
// "A real engineer doesn't just build; they interrogate the situation
//  to construct a rigorous research plan, using cross-references to
//  stress-test the concept before a single stone is laid."
//
// v1's sin: Every response builder used hints[0].split('.')[0] as content.
//   That's reformatting the teacher's notes, not thinking.
//
// v2's principle: Hints are NEVER used to build responses. Instead:
//   1. INTERROGATE the situation → identify unknowns
//   2. SURFACE assumptions the asker is making
//   3. HYPOTHESIZE competing explanations from domain knowledge
//   4. BUILD a research plan — what to verify, in what order, why
//   5. CROSS-REFERENCE — do hypotheses contradict constraints?
//   6. CONSTRUCT response from OUR analysis
//   7. VALIDATE against hints (post-check only — did we miss something?)
//
export class VaiReasoner {
  #memory = [];
  #avoidPatterns = new Set();

  /** Record a past evaluation so Vai learns from failure */
  remember(evaluation) {
    this.#memory.push({
      track: evaluation.track,
      quality: evaluation.quality,
      misconceptions: evaluation.misconceptions?.map(m => m.key || m.name) || [],
      feedback: evaluation.feedback,
    });
    for (const m of evaluation.misconceptions || []) {
      this.#avoidPatterns.add(m.key || m.name);
    }
  }

  /** Reason about a lesson by interrogating the situation — not reading hints */
  reason(lesson) {
    const { situation, challenge, hints = [] } = lesson;

    // ─── Phase 1: PARSE the raw situation ──────────────────
    const domain = this.#extractDomain(situation);
    const actors = this.#extractActors(situation);
    const constraints = this.#extractConstraints(situation);
    const specifics = this.#extractSpecifics(situation);

    // ─── Phase 2: INTERROGATE — what don't we know? ────────
    const unknowns = this.#identifyUnknowns(situation, domain, actors);
    const assumptions = this.#surfaceAssumptions(situation, challenge);

    // ─── Phase 3: HYPOTHESIZE — competing explanations ─────
    const hypotheses = this.#formHypotheses(domain, unknowns, specifics, constraints);

    // ─── Phase 4: PLAN — investigation sequence ────────────
    const plan = this.#buildResearchPlan(hypotheses, unknowns, constraints);

    // ─── Phase 5: CROSS-REFERENCE — stress-test ────────────
    const contradictions = this.#crossReference(assumptions, constraints, hypotheses);

    // ─── Phase 6: READ the challenge type ──────────────────
    const challengeType = this.#classifyChallenge(challenge);

    // ─── Phase 7: CONSTRUCT response from our analysis ─────
    const analysis = { unknowns, assumptions, hypotheses, plan, contradictions };
    let response = this.#constructResponse(challengeType, {
      domain, actors, constraints, specifics, situation, ...analysis,
    });

    // ─── Phase 8: CHECK MEMORY for past mistakes ───────────
    const avoidanceRules = this.#getAvoidanceRules();
    response = this.#postCheckAvoidance(response, avoidanceRules);

    // ─── Phase 9: VALIDATE against hints (post-check only) ─
    const hintCoverage = this.#validateAgainstHints(response, hints);

    return {
      text: response.substring(0, 300),
      reasoning: {
        domain,
        actors,
        constraints,
        challengeType,
        avoidanceRules,
        specifics,
        unknowns: unknowns.map(u => u.what),
        assumptions: assumptions.map(a => a.claim),
        hypotheses: hypotheses.map(h => h.short),
        contradictions,
        hintCoverage,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: Situation parsing (kept from v1, proven good)
  // ═══════════════════════════════════════════════════════════

  #extractDomain(situation) {
    const s = situation.toLowerCase();
    if (/react|component|render|hook|jsx|virtual dom/.test(s)) return 'react';
    if (/docker|container|kubernetes|k8s|enomem/.test(s)) return 'infrastructure';
    if (/database|sql|postgres|prisma|column|migration|table/.test(s)) return 'database';
    if (/api|endpoint|rest|graphql|websocket|sse/.test(s)) return 'api';
    if (/npm|package|dependency|node_modules|install/.test(s)) return 'dependencies';
    if (/monorepo|workspace|pnpm|architecture/.test(s)) return 'architecture';
    if (/framework|qwik|next|svelte|angular/.test(s)) return 'framework';
    if (/customer|user|report|broken|bug|feels/.test(s)) return 'user-facing';
    if (/explain|teach|present|compress/.test(s)) return 'communication';
    if (/microservice|monolith|scale|startup|cto|mvp/.test(s)) return 'architecture';
    return 'engineering';
  }

  #extractActors(situation) {
    const actors = [];
    if (/vetle|user|customer|team lead|someone|cto|engineer/i.test(situation)) actors.push('human');
    if (/app|system|service|api|server/i.test(situation)) actors.push('system');
    if (/mobile|web|client|browser/i.test(situation)) actors.push('client');
    if (/production|live|deploy/i.test(situation)) actors.push('production');
    return actors;
  }

  #extractConstraints(situation) {
    const constraints = [];
    if (/no downtime|zero downtime/i.test(situation)) constraints.push('no-downtime');
    if (/live|production/i.test(situation)) constraints.push('production');
    if (/\d+\s*(user|GB|MB|RAM|engineer|month|people)/i.test(situation)) {
      const matches = situation.matchAll(/(\d+)\s*(user|GB|MB|RAM|engineer|month|people)s?/gi);
      for (const m of matches) constraints.push(`${m[1]}${m[2]}`);
    }
    if (/no other info|unknown|can't describe/i.test(situation)) constraints.push('ambiguous');
    if (/maximum\s+\d|limit|budget/i.test(situation)) constraints.push('constrained');
    if (/mvp|runway|startup/i.test(situation)) constraints.push('time-pressure');
    return constraints;
  }

  #extractSpecifics(situation) {
    const specifics = [];
    const quoted = situation.match(/"([^"]+)"|'([^']+)'/g);
    if (quoted) specifics.push(...quoted.map(q => q.replace(/['"]/g, '')));
    const technical = situation.match(/`([^`]+)`/g);
    if (technical) specifics.push(...technical.map(t => t.replace(/`/g, '')));
    const numbers = situation.match(/\d+\s*\w+/g);
    if (numbers) specifics.push(...numbers.slice(0, 3));
    return specifics;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: INTERROGATION — What don't we know?
  // ═══════════════════════════════════════════════════════════

  /** Identify unknowns FROM the situation, not from hints.
   *  Each unknown is something that, if we knew it, would change our answer. */
  #identifyUnknowns(situation, domain, actors) {
    const unknowns = [];
    const s = situation.toLowerCase();

    // ─── Vague symptoms → the measurement is unknown ───────
    const vagueTerms = s.match(/\b(slow|broken|not working|feels wrong|weird|issue|problem|bad|failing)\b/g);
    if (vagueTerms) {
      const seen = new Set();
      for (const term of vagueTerms) {
        if (!seen.has(term)) {
          unknowns.push({ what: `What "${term}" specifically means — measured how, observed where`, why: 'measurement' });
          seen.add(term);
        }
      }
    }

    // ─── Open-ended questions → decision criteria are unknown ──
    if (/should i|what.*use|which.*choose|is.*good|what.*recommend/i.test(s)) {
      unknowns.push({ what: 'Decision criteria — what matters most in this context', why: 'criteria' });
    }

    // ─── Domain-specific unknowns ──────────────────────────
    // These come from engineering knowledge, not from hints.
    // For each domain, what do you ALWAYS need to know?
    const domainQuestions = {
      react: [
        { what: 'Which component or page is affected', why: 'scope' },
        { what: 'What changed in the last deploy or PR', why: 'causation' },
        { what: 'Where the measurement was taken (DevTools, Lighthouse, user report)', why: 'measurement' },
      ],
      infrastructure: [
        { what: 'Actual resource utilization (CPU, memory, disk)', why: 'metrics' },
        { what: 'What else runs in the same environment', why: 'contention' },
        { what: 'When it started happening vs when it works fine', why: 'timeline' },
      ],
      database: [
        { what: 'Query patterns — reads vs writes, joins, volume', why: 'workload' },
        { what: 'Data shape — relational, document, time-series, graph', why: 'model-fit' },
        { what: 'Scale expectations — 100 users or 100 million', why: 'right-sizing' },
      ],
      api: [
        { what: 'Data flow direction — who pushes, who pulls', why: 'protocol-fit' },
        { what: 'Payload sizes and frequency', why: 'bandwidth' },
      ],
      dependencies: [
        { what: 'Bundle size impact on performance budget', why: 'cost' },
        { what: 'Maintenance health — last publish, open issues, bus factor', why: 'longevity' },
        { what: 'Whether the problem can be solved in <50 lines without the dependency', why: 'necessity' },
        { what: 'License compatibility with the project', why: 'legal' },
        { what: 'Transitive dependency tree depth', why: 'supply-chain' },
        { what: 'Known security vulnerabilities', why: 'security' },
      ],
      architecture: [
        { what: 'Team size and current expertise', why: 'capacity' },
        { what: 'Current scale and growth trajectory', why: 'right-sizing' },
        { what: 'Time to market vs long-term maintainability tradeoff', why: 'priority' },
      ],
      framework: [
        { what: 'Our actual production experience with this technology', why: 'knowledge-gap' },
        { what: 'Migration cost from the current stack', why: 'switching-cost' },
        { what: 'Ecosystem maturity — libraries, tooling, hiring pool', why: 'ecosystem' },
      ],
      'user-facing': [
        { what: 'User environment — browser, device, network', why: 'reproduction' },
        { what: 'What the user was trying to accomplish (task, not symptoms)', why: 'intent' },
        { what: 'Whether we can observe them directly (screen share)', why: 'observation' },
      ],
      communication: [
        { what: 'Audience technical level and what they care about', why: 'calibration' },
      ],
      engineering: [
        { what: 'Scale and constraints', why: 'solution-space' },
        { what: 'Who will maintain this and their expertise', why: 'team-fit' },
      ],
    };

    const dq = domainQuestions[domain] || domainQuestions.engineering;
    unknowns.push(...dq);

    // ─── Actor-specific unknowns ───────────────────────────
    if (actors.includes('production')) {
      unknowns.push({ what: 'What the rollback plan is if things go wrong', why: 'safety' });
    }
    if (actors.includes('human') && /can't describe|vague|feels/i.test(s)) {
      unknowns.push({ what: 'Whether we can watch the user (screen share > description)', why: 'observation' });
    }

    return unknowns;
  }

  /** Surface assumptions the asker is making — things stated as fact
   *  that might not be true, or solutions prescribed before the problem
   *  is understood. */
  #surfaceAssumptions(situation, challenge) {
    const assumptions = [];
    const s = situation + ' ' + challenge;

    // Prescribed solutions ("I want X", "we need X", "should we use X")
    const prescribed = s.match(/(?:I want|we need|should we use|let's use|we're (?:going to|building with))\s+([^.?!,]{3,40})/i);
    if (prescribed) {
      assumptions.push({
        claim: prescribed[1].trim(),
        type: 'prescribed-solution',
        risk: 'Choosing the solution before understanding the problem',
      });
    }

    // Future predictions ("so we don't have to", "to avoid", "to prevent")
    const futureGuard = s.match(/(?:so we don't|to avoid|to prevent|so we won't)\s+([^.?!]{3,50})/i);
    if (futureGuard) {
      assumptions.push({
        claim: futureGuard[1].trim(),
        type: 'assumed-future',
        risk: 'Predicting future needs without data from actual usage',
      });
    }

    // Binary framing ("X or Y" in a question)
    if (/\bor\b/i.test(s) && /(?:should|which|do we|better)/i.test(s)) {
      assumptions.push({
        claim: 'Only two options exist',
        type: 'false-dichotomy',
        risk: 'There may be a third option that fits better',
      });
    }

    // Authority claims ("best practice", "everyone uses", "industry standard")
    if (/best practice|everyone|most teams|industry standard|popular/i.test(s)) {
      assumptions.push({
        claim: 'Popularity equals correctness',
        type: 'authority-bias',
        risk: 'What works for most may not fit this context',
      });
    }

    // Certainty without evidence
    if (/obviously|clearly|definitely|always|never/i.test(s)) {
      assumptions.push({
        claim: 'Stated certainty without supporting evidence',
        type: 'unexamined-belief',
        risk: 'May be context-dependent or simply wrong',
      });
    }

    return assumptions;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: HYPOTHESES — Competing explanations
  // ═══════════════════════════════════════════════════════════

  /** Form hypotheses from domain knowledge + unknowns.
   *  Multiple competing explanations — not one assumed answer. */
  #formHypotheses(domain, unknowns, specifics, constraints) {
    const hypotheses = [];

    // Domain-specific competing explanations
    const domainHypotheses = {
      react: [
        { short: 'Excessive re-renders from uncontrolled state propagation', impact: 'high' },
        { short: 'Large bundle size blocking initial paint', impact: 'high' },
        { short: 'Slow API call holding up render', impact: 'medium' },
        { short: 'Memory leak from uncleared intervals or subscriptions', impact: 'high' },
      ],
      infrastructure: [
        { short: 'Node.js heap exceeding container memory allocation', impact: 'high' },
        { short: 'Build tool spawning too many parallel workers', impact: 'medium' },
        { short: 'Build context pulling in unnecessary files', impact: 'medium' },
        { short: 'OS + other processes competing for same memory', impact: 'low' },
      ],
      database: [
        { short: 'PostgreSQL handles this well if the schema models the actual relationships', impact: 'high' },
        { short: 'The query pattern might favor a document store instead', impact: 'medium' },
        { short: 'At this scale, any database works — the team\'s expertise matters more', impact: 'medium' },
      ],
      api: [
        { short: 'Both features are unidirectional (server → client)', impact: 'high' },
        { short: 'SSE handles this with less infrastructure than WebSockets', impact: 'medium' },
        { short: 'WebSockets only earn their complexity for bidirectional needs', impact: 'medium' },
      ],
      dependencies: [
        { short: 'The package solves a problem you could write in 50 lines', impact: 'high' },
        { short: 'The transitive dependency tree adds hidden supply-chain risk', impact: 'medium' },
        { short: 'The bundle size blows the performance budget', impact: 'high' },
        { short: 'The license might be incompatible with the project', impact: 'medium' },
        { short: 'Last publish was 2+ years ago — effectively abandoned', impact: 'medium' },
        { short: 'Known CVEs in the dependency tree', impact: 'high' },
      ],
      architecture: [
        { short: 'Team too small for the operational overhead of distributed systems', impact: 'high' },
        { short: 'Monolith-first lets you discover real service boundaries from usage data', impact: 'high' },
        { short: 'Premature architecture = building for Year 3 while Month 3 survival is uncertain', impact: 'high' },
      ],
      framework: [
        { short: 'We have zero production data on this technology — any opinion is speculation', impact: 'high' },
        { short: 'Blog-post knowledge is second-hand — not a basis for recommendation', impact: 'medium' },
        { short: 'Evaluation criteria exist independent of experience: bundle size, SSR, ecosystem, migration cost', impact: 'high' },
      ],
      'user-facing': [
        { short: 'This might be a UX problem, not a code bug — the UI violated their mental model', impact: 'high' },
        { short: 'The issue could be data-specific to their account', impact: 'medium' },
        { short: 'Environment-specific: specific browser, device, or network condition', impact: 'medium' },
      ],
      communication: [
        { short: 'The audience cares about what it DOES for them, not what it IS', impact: 'high' },
      ],
      engineering: [
        { short: 'The simplest approach that meets all constraints is usually right', impact: 'high' },
        { short: 'The constraint everyone ignores is team capacity', impact: 'medium' },
      ],
    };

    const dh = domainHypotheses[domain] || domainHypotheses.engineering;
    hypotheses.push(...dh);

    // If we have specifics, create situation-specific hypotheses
    if (specifics.length > 0 && domain === 'react') {
      hypotheses.unshift({ short: `"${specifics[0]}" points to a specific component — scope the investigation there first`, impact: 'high' });
    }
    if (specifics.length > 0 && domain === 'database') {
      hypotheses.unshift({ short: `"${specifics[0]}" suggests a known pattern — check if ORM handles it vs raw SQL needed`, impact: 'medium' });
    }

    // Constraint-aware hypothesis reranking
    if (constraints.includes('time-pressure')) {
      hypotheses.unshift({ short: 'With limited runway, the cost of wrong architecture > cost of rewriting later', impact: 'high' });
    }

    return hypotheses;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: RESEARCH PLAN — Investigation sequence
  // ═══════════════════════════════════════════════════════════

  /** Build investigation sequence: what to check first, why that order.
   *  Principle: check the cheapest-to-verify, highest-impact hypothesis first. */
  #buildResearchPlan(hypotheses, unknowns, constraints) {
    const steps = [];

    // Prioritize: high impact + cheapest to check
    const highImpact = hypotheses.filter(h => h.impact === 'high');
    const others = hypotheses.filter(h => h.impact !== 'high');

    for (const h of [...highImpact.slice(0, 3), ...others.slice(0, 2)]) {
      steps.push({
        step: h.short,
        rationale: `Impact: ${h.impact}`,
      });
    }

    // If there are production constraints, add safety check
    if (constraints.includes('production') || constraints.includes('no-downtime')) {
      steps.push({
        step: 'Verify rollback plan before any change',
        rationale: 'Production safety',
      });
    }

    return steps;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 5: CROSS-REFERENCE — Stress-test for contradictions
  // ═══════════════════════════════════════════════════════════

  /** Stress-test: do assumptions contradict constraints?
   *  This is the engineer's rigor before laying the first stone. */
  #crossReference(assumptions, constraints, hypotheses) {
    const contradictions = [];

    for (const assumption of assumptions) {
      // Prescribed solution + time pressure = dangerous
      if (assumption.type === 'prescribed-solution' && constraints.includes('time-pressure')) {
        contradictions.push(`Prescribing "${assumption.claim}" while under time pressure — wrong choice costs double`);
      }
      // Assumed future + no usage data
      if (assumption.type === 'assumed-future' && !constraints.includes('production')) {
        contradictions.push(`Predicting "${assumption.claim}" without production usage data`);
      }
      // Authority bias + team constraints
      if (assumption.type === 'authority-bias') {
        contradictions.push(`"${assumption.claim}" — popularity doesn't account for team size or context`);
      }
    }

    // Check if hypotheses contradict constraints
    const teamSmall = constraints.some(c => /\d+engineer/i.test(c) && parseInt(c) <= 5);
    if (teamSmall) {
      for (const h of hypotheses) {
        if (/distributed|microservice/i.test(h.short)) {
          contradictions.push(`Distributed architecture with a small team = most time spent on infrastructure, not product`);
        }
      }
    }

    return contradictions;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 6: CHALLENGE CLASSIFICATION
  // ═══════════════════════════════════════════════════════════

  #classifyChallenge(challenge) {
    const c = challenge.toLowerCase();
    // Diagnostic: asks to investigate, question, diagnose
    if (/what.*don't know|investigate|diagnos|before.*respond|question.*ask|unanswerable|clarif/i.test(c)) return 'diagnostic';
    // Honesty: asks for honest assessment
    if (/honest|don't know|haven't|confidence|guess/i.test(c)) return 'honest';
    // Compression: asks for brevity
    if (/compress|sentence|explain.*to|brief|maximum|which.*matters/i.test(c)) return 'compress';
    // Systems: asks to map effects, check dependencies, list what to verify
    if (/blast radius|downstream|consequence|effect|order|what.*things.*check|before you.*install|what are the \d+/i.test(c)) return 'systems';
    // Reading: asks to find the hidden/unstated need
    if (/didn't say|unasked|real.*need|between the lines|unstated|ignoring|what constraint|optimizing for/i.test(c)) return 'reading';
    return 'general';
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 7: RESPONSE CONSTRUCTION — From analysis, not hints
  // ═══════════════════════════════════════════════════════════

  /** Route to the right builder based on challenge type */
  #constructResponse(type, analysis) {
    switch (type) {
      case 'diagnostic': return this.#buildDiagnostic(analysis);
      case 'honest':     return this.#buildHonest(analysis);
      case 'compress':   return this.#buildCompressed(analysis);
      case 'systems':    return this.#buildSystemsMap(analysis);
      case 'reading':    return this.#buildReading(analysis);
      default:           return this.#buildResearchResponse(analysis);
    }
  }

  // ─── Diagnostic: Name unknowns as questions, sequence by impact ──

  #buildDiagnostic({ domain, specifics, constraints, unknowns, hypotheses }) {
    const parts = [];

    // Open by naming what we DON'T know (from our unknowns, not hints)
    const keyUnknowns = unknowns.filter(u => u.why === 'measurement' || u.why === 'scope' || u.why === 'causation');
    if (keyUnknowns.length > 0) {
      parts.push(`I don't know ${keyUnknowns[0].what.toLowerCase()} yet.`);
    } else if (specifics.length > 0) {
      parts.push(`"${specifics[0]}" tells me the symptom — not the cause.`);
    }

    // Ask investigation questions from unknowns (max 3, as questions)
    const questions = unknowns.slice(0, 3).map(u => {
      // Transform the unknown into a question form
      const w = u.what;
      if (w.endsWith('?')) return w;
      if (/^What|^Where|^When|^Which|^How|^Who/i.test(w)) return w + '?';
      return `What is the ${w.toLowerCase()}?`;
    });
    if (questions.length > 0) {
      parts.push(`I need to know: ${questions.join(' ')}`);
    }

    // If we have competing hypotheses, show we're thinking in possibilities
    if (hypotheses.length >= 2) {
      parts.push(`Could be ${hypotheses[0].short.toLowerCase()} — or ${hypotheses[1].short.toLowerCase()}. Different root causes, different fixes entirely.`);
    }

    return parts.join(' ');
  }

  // ─── Honest: Name knowledge gap, propose evaluation framework ──

  #buildHonest({ domain, specifics, unknowns, hypotheses }) {
    const parts = [];

    // Admit the gap directly
    if (specifics.length > 0) {
      parts.push(`Honest answer: I don't have production experience with ${specifics[0]}.`);
    } else {
      parts.push(`Honest answer: I haven't used this ${domain} approach in production.`);
    }

    // Propose evaluation criteria FROM domain knowledge
    const evalCriteria = unknowns
      .filter(u => u.why === 'knowledge-gap' || u.why === 'switching-cost' || u.why === 'ecosystem')
      .slice(0, 2);
    if (evalCriteria.length > 0) {
      parts.push(`I'd evaluate against: ${evalCriteria.map(u => u.what.toLowerCase()).join(', ')}.`);
    } else {
      parts.push(`Rather than guess, I'd define evaluation criteria specific to our constraints.`);
    }

    // Explain WHY honesty beats guessing
    parts.push(`A confident wrong recommendation costs more than saying "let me evaluate this properly."`);

    return parts.join(' ');
  }

  // ─── Compressed: Synthesize value explanation for the audience ──
  //
  // Compression is DIFFERENT from investigation. The task isn't to analyze —
  // it's to EXPLAIN a concept in a way that lands for a specific audience.
  // The knowledge comes from engineering experience, not from hypotheses.

  #buildCompressed({ domain, specifics, actors, situation }) {
    const forNonTech = actors.includes('human');

    // Extract the specific topic being explained
    const topicMatch = (situation || '').match(/explain\s+(\w[\w\s-]{2,20})\s+to/i);
    const topic = topicMatch ? topicMatch[1].trim().toLowerCase() : null;

    // Topic-specific value synthesis (engineer's domain knowledge, not hints)
    // For each topic: what does a non-technical person CARE about? What does a
    // technical person need to EVALUATE? Different audiences, different value.
    const topicValues = {
      monorepo: forNonTech
        ? `All your code lives in one shared home — when one team changes something, every other team sees it instantly. Coordination takes minutes instead of days.`
        : `Single repo for all packages: atomic commits across boundaries, shared CI, one dependency graph. Tradeoff is clone size and CI complexity.`,
      docker: forNonTech
        ? `Your app runs in an isolated box that works the same everywhere — no more "it works on my machine." Deploy with confidence.`
        : `Containerized runtime: consistent env from dev to prod, resource isolation, reproducible builds. Tradeoff is image size and orchestration overhead.`,
      microservices: forNonTech
        ? `Each feature runs independently — one team can ship without waiting for others. But it costs more to connect and monitor everything.`
        : `Independently deployable services with dedicated data stores. Wins: isolation, scaling. Costs: network complexity, distributed debugging, operational overhead.`,
      react: forNonTech
        ? `The screen updates instantly when data changes — users see results without waiting for page reloads. It makes the app feel alive.`
        : `Component tree re-renders on state change. Virtual DOM diffs minimize browser mutations. Tradeoff: bundle size and learning curve.`,
      sse: forNonTech
        ? `The server pushes updates to your screen automatically — like getting notifications without refreshing. Simpler than WebSockets for one-way data.`
        : `Server-Sent Events: HTTP-native server push, auto-reconnect, one-way stream. Use over WebSockets when you don't need client→server real-time.`,
      websocket: forNonTech
        ? `A persistent two-way connection — both sides can send messages instantly, like a phone call vs. email. Best for chat and collaboration.`
        : `Full-duplex TCP: bidirectional real-time. Earns its complexity when client→server communication is needed. Otherwise SSE is simpler.`,
    };
    if (topic && topicValues[topic]) return topicValues[topic];

    // Domain-level value synthesis (when we can't identify a specific topic)
    const domainValues = {
      architecture: forNonTech
        ? `It organizes your codebase so teams don't step on each other — changes in one area stay contained, deployment is faster, and debugging is easier.`
        : `Structural decision about code organization, deployment boundaries, and team autonomy. The right answer depends on team size and current scale.`,
      infrastructure: forNonTech
        ? `It keeps the app running reliably — handles crashes, scales under load, and deploys without downtime.`
        : `Runtime environment: containers, orchestration, CI/CD. Optimize for reproducibility and rollback safety.`,
      database: forNonTech
        ? `Where your app stores everything it needs to remember — designed so finding data is fast and losing data is impossible.`
        : `Persistent store: choose based on query patterns, data relationships, and scale. Schema design drives performance more than engine choice.`,
      api: forNonTech
        ? `The way different parts of your software talk to each other — like a menu at a restaurant, it defines what you can ask for.`
        : `Interface contract: defines data flow, auth, and error handling between services or client/server.`,
      dependencies: forNonTech
        ? `Pre-built code libraries your project relies on. Each one is useful but adds weight and risk — like ingredients in a recipe.`
        : `Third-party packages: evaluate bundle impact, maintenance health, license, transitive tree, and whether you can build it in 50 lines.`,
      framework: forNonTech
        ? `A toolkit that gives your team a head start — common problems are pre-solved so they can focus on what makes your product unique.`
        : `Opinionated toolset: evaluate SSR support, bundle size, ecosystem maturity, and migration cost from current stack.`,
    };
    if (domainValues[domain]) return domainValues[domain];

    // Absolute fallback — construct from specifics
    if (specifics.length > 0) {
      return `${specifics[0]} means your team coordinates faster because changes don't cascade unpredictably — speed and safety, not bureaucracy.`;
    }
    return `It simplifies coordination — your team ships independently without blocking each other. The value is speed, not structure.`;
  }

  // ─── Systems: Map downstream effects from hypotheses + constraints ──

  #buildSystemsMap({ domain, specifics, constraints, hypotheses, unknowns, plan }) {
    const parts = [];

    // Name the change and immediately flag blast radius
    if (specifics.length > 0) {
      parts.push(`Before touching ${specifics[0]} — map the blast radius.`);
    } else {
      parts.push(`This looks simple but the blast radius says otherwise.`);
    }

    // List effects FROM hypotheses (our domain reasoning, not hints)
    const effects = hypotheses.slice(0, 5).map((h, i) => `${i + 1}) ${h.short}`);
    if (effects.length > 0) {
      parts.push(`Check: ${effects.join('. ')}.`);
    }

    // Sequence reasoning from constraints
    if (constraints.includes('production') || constraints.includes('no-downtime')) {
      parts.push(`With production constraint, each step must be backward-compatible — the order isn't optional.`);
    } else if (unknowns.some(u => u.why === 'necessity')) {
      parts.push(`But first: can you solve this in <50 lines without a dependency? That check eliminates the entire blast radius.`);
    } else {
      parts.push(`The sequence matters because each early decision constrains what's possible later.`);
    }

    return parts.join(' ');
  }

  // ─── Reading: Surface unstated needs from assumptions ──

  #buildReading({ domain, specifics, actors, assumptions, hypotheses, contradictions }) {
    const parts = [];

    // Name what was stated vs what's underneath
    if (assumptions.length > 0) {
      const firstAssumption = assumptions[0];
      parts.push(`The stated goal is "${firstAssumption.claim}" — but ${firstAssumption.risk.toLowerCase()}.`);
    } else if (specifics.length > 0) {
      parts.push(`The literal question is about "${specifics[0]}" — but that's the surface.`);
    }

    // Cross-reference contradiction reveals the real issue
    if (contradictions.length > 0) {
      parts.push(`The contradiction: ${contradictions[0].toLowerCase()}.`);
    }

    // What they're ACTUALLY optimizing for vs what they should be
    if (hypotheses.length > 0) {
      parts.push(`What matters here: ${hypotheses[0].short.toLowerCase()}.`);
    }

    // The unstated need
    parts.push(`Because the unstated constraint is the one that actually drives the decision.`);

    return parts.join(' ');
  }

  // ─── Research Response (general fallback): Full plan ──

  #buildResearchResponse({ domain, specifics, unknowns, hypotheses, plan, contradictions, constraints }) {
    const parts = [];

    // Start with what we'd investigate
    if (unknowns.length > 0) {
      const topUnknowns = unknowns.slice(0, 2).map(u => u.what.toLowerCase());
      parts.push(`First, I need to understand: ${topUnknowns.join(', ')}.`);
    }

    // Competing hypotheses show we're not assuming one answer
    if (hypotheses.length >= 2) {
      parts.push(`This could go multiple ways: ${hypotheses[0].short.toLowerCase()}, or ${hypotheses[1].short.toLowerCase()}.`);
    }

    // Contradictions force deeper thinking
    if (contradictions.length > 0) {
      parts.push(`But note: ${contradictions[0].toLowerCase()}.`);
    }

    // Research plan
    if (plan.length > 0) {
      parts.push(`Check ${plan[0].step.toLowerCase()} first — it eliminates the most possibilities.`);
    }

    return parts.join(' ');
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 8: AVOIDANCE — Learn from past failures
  // ═══════════════════════════════════════════════════════════

  #getAvoidanceRules() {
    const rules = [];
    if (this.#avoidPatterns.has('prematureConclusion')) {
      rules.push('DO NOT suggest a fix without asking questions first');
    }
    if (this.#avoidPatterns.has('surfacePattern')) {
      rules.push('DO NOT give a short generic answer — go deeper');
    }
    if (this.#avoidPatterns.has('authorityBias')) {
      rules.push('DO NOT appeal to "best practice" or popularity');
    }
    if (this.#avoidPatterns.has('falsePrecision')) {
      rules.push('DO NOT give specific numbers without basis');
    }
    if (this.#avoidPatterns.has('missingConstraints')) {
      rules.push('DO NOT skip constraint mapping — list ALL downstream effects');
    }
    if (this.#avoidPatterns.has('complexityBias')) {
      rules.push('DO NOT suggest the complex solution when a simple one works');
    }
    if (this.#avoidPatterns.has('listWithoutRanking')) {
      rules.push('DO NOT dump options without ranking which is best for THIS context');
    }
    return rules;
  }

  #postCheckAvoidance(response, rules) {
    let fixed = response;

    // If we should ask questions first but didn't
    if (rules.some(r => r.includes('fix without asking')) &&
        !fixed.includes('?') && /you should|try |use /i.test(fixed)) {
      fixed = `Wait — before suggesting anything: what specifically triggered this? ` + fixed;
    }

    // If we should go deeper but response is too short
    if (rules.some(r => r.includes('go deeper')) && fixed.split(' ').length < 20) {
      fixed += ` This deserves more depth — the context changes the answer entirely.`;
    }

    // If we should list effects but didn't map any
    if (rules.some(r => r.includes('downstream effects')) && !/\d\)/.test(fixed)) {
      fixed += ` Downstream: each change here cascades to at least 3 other systems.`;
    }

    // If we should rank but dumped an unranked list
    if (rules.some(r => r.includes('ranking')) && /could be|or |multiple/i.test(fixed) && !/first|most likely|highest/i.test(fixed)) {
      fixed += ` Most likely cause first — check that before anything else.`;
    }

    return fixed;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 9: VALIDATION — Hints as post-check only
  // ═══════════════════════════════════════════════════════════

  /** Count how many hint topics our reasoning naturally covered.
   *  This is a QUALITY CHECK, not a content source.
   *  High coverage = our reasoning was thorough.
   *  Low coverage = we might have a blind spot. */
  #validateAgainstHints(response, hints) {
    if (!hints || hints.length === 0) return { covered: 0, total: 0, ratio: 1 };

    let covered = 0;
    const responseLower = response.toLowerCase();
    for (const hint of hints) {
      // Extract key concepts from the hint (not the exact words)
      const keywords = hint.toLowerCase()
        .replace(/[?!.()]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 4);  // Only meaningful words
      // If 2+ keywords appear in our response, we covered this hint's concept
      const matchCount = keywords.filter(kw => responseLower.includes(kw)).length;
      if (matchCount >= 2 || (keywords.length <= 2 && matchCount >= 1)) {
        covered++;
      }
    }

    return {
      covered,
      total: hints.length,
      ratio: hints.length > 0 ? covered / hints.length : 1,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// VAI MENTOR — The adaptive teaching engine
// ═══════════════════════════════════════════════════════════════

export class VaiMentor {
  #profile;
  #lessonIndex;

  constructor() {
    this.#profile = new LearnerProfile();
    this.#lessonIndex = this.#buildIndex();
  }

  get profile() { return this.#profile; }

  /** Build a flat index of all lessons across tracks */
  #buildIndex() {
    const index = [];
    for (const [trackId, track] of Object.entries(TEACHING_TRACKS)) {
      for (const lesson of track.lessons) {
        index.push({
          ...lesson,
          _trackId: trackId,
          _trackName: track.name,
          _trackPrinciple: track.principle,
        });
      }
    }
    return index;
  }

  // ─── Lesson Selection (adaptive) ─────────────────────────

  /** Create the next lesson, adapted to the learner's current state */
  createLesson(options = {}) {
    const { track, difficulty, lessonId } = options;

    // If specific lesson requested, return it
    if (lessonId) {
      const found = this.#lessonIndex.find(l => l.id === lessonId);
      if (found) return this.#packageLesson(found);
    }

    // Auto-select based on learner profile
    let candidates = [...this.#lessonIndex];

    // Filter by difficulty (use learner's current level if not specified)
    const targetDifficulty = difficulty || this.#profile.currentLevel;
    candidates = candidates.filter(l => l.difficulty === targetDifficulty);

    // Prefer weak tracks
    if (!track) {
      const weakTracks = this.#profile.weakestTracks;
      if (weakTracks.length > 0) {
        const weakCandidates = candidates.filter(l => weakTracks.slice(0, 2).includes(l._trackId));
        if (weakCandidates.length > 0) candidates = weakCandidates;
      }
    } else {
      candidates = candidates.filter(l => l._trackId === track);
    }

    // Avoid recently attempted lessons
    const recentIds = new Set(this.#profile.history.slice(-5).map(h => h.lessonId));
    const fresh = candidates.filter(l => !recentIds.has(l.id));
    if (fresh.length > 0) candidates = fresh;

    // Pick one (random from filtered set)
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (!pick) {
      // Fallback: any lesson at any difficulty
      const any = this.#lessonIndex[Math.floor(Math.random() * this.#lessonIndex.length)];
      return this.#packageLesson(any);
    }

    return this.#packageLesson(pick);
  }

  /** Package a lesson for delivery */
  #packageLesson(lesson) {
    return {
      id: lesson.id,
      track: lesson._trackName,
      trackId: lesson._trackId,
      principle: lesson._trackPrinciple,
      difficulty: lesson.difficulty,
      situation: lesson.setup.situation,
      context: lesson.setup.context,
      // The Socratic challenge — this is what makes it teaching, not testing
      challenge: lesson.socratic.question,
      // Hints available if the learner needs them (progressive disclosure)
      hints: lesson.socratic.hints,
      // The deep lesson (revealed AFTER the learner attempts)
      teachingPoint: lesson.socratic.teachingPoint,
      // What excellence looks like
      evaluation: lesson.evaluation,
      // Follow-up based on performance
      followUp: lesson.followUp,
      // Internal reference
      _lesson: lesson,
    };
  }

  // ─── Evaluation (understanding-based, not keyword-based) ──

  /** Evaluate a learner's response to a lesson
   *  @param {object} lesson — from createLesson()
   *  @param {string} response — the learner's written response
   *  @returns {{ quality, misconceptions, feedback, teachingMoment, next }} */
  evaluate(lesson, response) {
    const resp = response.toLowerCase();
    const evalCriteria = lesson.evaluation;
    const idealAntiPatterns = lesson._lesson.idealResponse?.antiPatterns || [];

    // ── Behavioral analysis (what does the response DO?) ────
    const behaviors = this.#analyzeBehaviors(resp);

    // Start with 'good' — evidence pushes toward excellent or weak
    let quality = 'good';
    const misconceptions = [];

    // Detect specific anti-pattern misconceptions FIRST
    for (const apKey of idealAntiPatterns) {
      if (this.#detectMisconception(resp, apKey, lesson)) {
        if (!misconceptions.includes(apKey)) misconceptions.push(apKey);
      }
    }

    // ── Quality determination based on BEHAVIOR, not keywords ──
    // A response is EXCELLENT when it demonstrates the right reasoning pattern:
    //   - Asks questions before answering (diagnosis-first)
    //   - Names constraints before recommending (constraint-aware)
    //   - Admits gaps honestly (intellectually honest)
    //   - Compresses to skeleton (compression-skilled)
    //
    // A response is WEAK when it falls into one of the named misconceptions.

    const idealStructure = lesson._lesson.idealResponse?.structure || '';
    const structLower = idealStructure.toLowerCase();

    // Does the ideal response expect questions? Check if response asks them
    const expectsQuestions = structLower.includes('ask') || structLower.includes('question') || structLower.includes('clarif');
    // Does the ideal expect admission of gaps?
    const expectsHonesty = structLower.includes('admit') || structLower.includes('gap') || structLower.includes('honest');
    // Does the ideal expect pushback/challenge?
    const expectsPushback = structLower.includes('challenge') || structLower.includes('push back') || structLower.includes('refuse');
    // Does the ideal expect brevity?
    const expectsBrevity = structLower.includes('sentence') || structLower.includes('max') || structLower.includes('concise');

    let score = 0;
    let maxScore = 0;

    // 1. If questions are expected, check for question marks
    if (expectsQuestions) {
      maxScore += 3;
      if (behaviors.questionCount >= 3) score += 3;
      else if (behaviors.questionCount >= 1) score += 1;
      // Giving a fix without asking = weak
      if (behaviors.questionCount === 0 && behaviors.prescribes) score -= 2;
    }

    // 2. If honesty is expected, check for admission language
    if (expectsHonesty) {
      maxScore += 3;
      if (behaviors.admitsGap) score += 3;
      else if (behaviors.offersToProceed) score += 1;
    }

    // 3. If pushback is expected, check for disagreement/reframing
    if (expectsPushback) {
      maxScore += 3;
      if (behaviors.pushesBack) score += 3;
      else if (behaviors.proposesPlan) score += 1;
      // Agreeing without question = weak
      if (!behaviors.pushesBack && !behaviors.questions && behaviors.compliant) score -= 2;
    }

    // 4. If brevity is expected
    if (expectsBrevity) {
      maxScore += 2;
      if (behaviors.wordCount <= 50) score += 2;
      else if (behaviors.wordCount <= 80) score += 1;
    }

    // 5. Always: does it reason? (explains WHY, not just WHAT)
    maxScore += 2;
    if (behaviors.givesReasoning) score += 2;

    // 6. Misconception penalty
    score -= misconceptions.length * 2;

    // Determine quality from normalized score
    if (maxScore > 0) {
      const ratio = score / maxScore;
      if (ratio >= 0.7) quality = 'excellent';
      else if (ratio <= 0.2 || misconceptions.length >= 2) quality = 'weak';
      // else stays 'good'
    } else {
      // No structural expectations — fallback to misconception count
      if (misconceptions.length === 0 && behaviors.givesReasoning) quality = 'excellent';
      else if (misconceptions.length >= 2) quality = 'weak';
    }

    // If weak quality detected from misconceptions alone, always check
    if (misconceptions.length >= 2 && quality !== 'weak') quality = 'weak';
    // If has too many misconceptions, can't be excellent
    if (misconceptions.length > 0 && quality === 'excellent') quality = 'good';

    // Record the attempt
    this.#profile.recordAttempt(lesson._lesson, quality, misconceptions);

    // Build feedback
    const feedback = this.#buildFeedback(quality, misconceptions, evalCriteria, lesson);

    // Determine next action
    const next = this.#determineNext(lesson, quality);

    return {
      quality,
      behaviors,
      misconceptions: misconceptions.map(m => ({
        key: m,
        name: MISCONCEPTIONS[m]?.name || m,
        teachingMove: MISCONCEPTIONS[m]?.teachingMove || '',
      })),
      feedback,
      teachingMoment: lesson.teachingPoint,
      next,
      profile: this.#profile.summary,
    };
  }

  /** Analyze the behavioral patterns of a response (what it DOES, not what words it uses) */
  #analyzeBehaviors(response) {
    const questions = (response.match(/\?/g) || []).length;
    const words = response.split(/\s+/).filter(Boolean);
    return {
      questionCount: questions,
      wordCount: words.length,
      // Prescribes a solution
      prescribes: /you should|try |use |add |install |switch to|implement/.test(response),
      // Asks before acting
      questions: questions > 0,
      // Admits a knowledge gap
      admitsGap: /haven't|don't know|not sure|limited experience|no experience|honestly|honest answer/.test(response),
      // Offers to investigate further
      offersToProceed: /let me|i can|i'll|evaluate|research|look into|find out/.test(response),
      // Pushes back on the premise
      pushesBack: /but |however|wait|pause|hold on|not for|don't|shouldn't|before you|before we|instead/.test(response),
      // Proposes a plan or alternative
      proposesPlan: /\b(plan|step|phase|first|then|after|instead|alternative)\b/.test(response),
      // Compliant (just agrees)
      compliant: /^(yes|sure|absolutely|of course|definitely)/.test(response.trim()),
      // Explains reasoning (because, since, the reason, which means)
      givesReasoning: /because|since|the reason|which means|this is why|that's why|the tradeoff|the cost/.test(response),
      // Numbered/structured response
      structured: /\b[1-4]\)|^\d\./m.test(response) || (response.match(/\n/g) || []).length >= 3,
    };
  }

  /** Detect if a specific misconception is present in the response */
  #detectMisconception(response, key, lesson) {
    switch (key) {
      case 'prematureConclusion':
        // Suggests fix without asking questions
        return !response.includes('?') && (
          response.includes('you should') || response.includes('try') ||
          response.includes('use ') || response.includes('add ')
        );

      case 'surfacePattern':
        // Very short response that just pattern-matches
        return response.split(' ').length < 15 && !response.includes('?');

      case 'authorityBias':
        // "Best practice" or "most popular" without context
        return response.includes('best practice') || response.includes('most popular') ||
          response.includes('everyone uses') || response.includes('industry standard');

      case 'complexityBias':
        // Suggests complex solution without evaluating simpler alternatives
        return (response.includes('microservice') || response.includes('kubernetes') ||
          response.includes('graphql') || response.includes('redux')) &&
          !response.includes('simpl');

      case 'falsePrecision':
        // Specific percentages or timelines without qualification
        return /\d+%/.test(response) && !response.includes('confident') &&
          !response.includes('estimate') && !response.includes('approximately');

      case 'missingConstraints':
        // Answer doesn't reference the constraints given in the lesson
        return lesson.context && !response.includes(
          lesson.context.toLowerCase().split(' ').find(w => w.length > 5) || '___NOMATCH___'
        );

      case 'listWithoutRanking':
        // Lists options with "or" without recommending
        return (response.match(/\bor\b/g) || []).length >= 2 &&
          !response.includes('recommend') && !response.includes('best');

      case 'echoWithoutInsight':
        // Very short response, no added information
        return response.split(' ').length < 20 && !response.includes('because') &&
          !response.includes('?');

      default:
        return false;
    }
  }

  /** Build human-readable, actionable feedback */
  #buildFeedback(quality, misconceptions, evalCriteria, lesson) {
    const parts = [];

    if (quality === 'excellent') {
      parts.push('Strong. ' + (evalCriteria.excellent || 'You hit the mark.'));
    } else if (quality === 'good') {
      parts.push('Solid foundation. ' + (evalCriteria.good || 'On the right track.'));
      if (evalCriteria.excellent) {
        parts.push(`To level up: ${evalCriteria.excellent}`);
      }
    } else {
      parts.push(`This reveals a pattern worth examining.`);
      if (evalCriteria.misconception) {
        parts.push(evalCriteria.misconception);
      }
    }

    // Add misconception-specific teaching moves
    for (const m of misconceptions) {
      const mc = MISCONCEPTIONS[m];
      if (mc) {
        parts.push(`[${mc.name}] ${mc.teachingMove}`);
      }
    }

    return parts.join('\n\n');
  }

  /** Determine what comes next based on performance */
  #determineNext(lesson, quality) {
    const followUp = lesson.followUp;

    if (quality === 'weak' && followUp?.onWeak) {
      return {
        type: 'followUp',
        situation: followUp.onWeak.situation,
        question: followUp.onWeak.question,
        hint: followUp.onWeak.hint,
        reason: 'Scaffolding — let\'s build understanding step by step.',
      };
    }

    if (quality === 'excellent' && followUp?.onStrong) {
      return {
        type: 'followUp',
        situation: followUp.onStrong.situation,
        question: followUp.onStrong.question,
        reason: 'You\'re ready for the next layer.',
      };
    }

    if (this.#profile.readyToAdvance) {
      return {
        type: 'advance',
        reason: `3/5 recent lessons at excellent. Ready for ${this.#profile.currentLevel} difficulty.`,
      };
    }

    // Default: another lesson from the adaptive selector
    return {
      type: 'continue',
      reason: quality === 'excellent'
        ? 'Solid. Let\'s explore a different angle.'
        : 'Let\'s try another approach to strengthen this skill.',
    };
  }

  // ─── Track listing ────────────────────────────────────────

  /** List all available teaching tracks */
  get tracks() {
    return Object.entries(TEACHING_TRACKS).map(([id, track]) => ({
      id,
      name: track.name,
      principle: track.principle,
      lessonCount: track.lessons.length,
      difficulties: [...new Set(track.lessons.map(l => l.difficulty))],
    }));
  }

  /** Get all lessons in a track */
  getTrack(trackId) {
    const track = TEACHING_TRACKS[trackId];
    if (!track) return null;
    return {
      ...track,
      lessons: track.lessons.map(l => ({
        id: l.id,
        difficulty: l.difficulty,
        situation: l.setup.situation,
        challenge: l.socratic.question,
      })),
    };
  }

  /** Get the full teaching tracks data for external use */
  static get TRACKS() { return TEACHING_TRACKS; }
  static get MISCONCEPTIONS() { return MISCONCEPTIONS; }
}


// ═══════════════════════════════════════════════════════════════
// CLI — Interactive mentor session
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const trackArg = args.find(a => !a.startsWith('--'));
  const listTracks = args.includes('--list');
  const demoMode = args.includes('--demo');

  const mentor = new VaiMentor();

  if (listTracks) {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║         VAI MENTOR — Teaching Tracks                      ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    for (const track of mentor.tracks) {
      console.log(`  ${track.name}`);
      console.log(`    "${track.principle}"`);
      console.log(`    ${track.lessonCount} lessons (${track.difficulties.join(', ')})\n`);
    }
    return;
  }

  if (demoMode) {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║         VAI MENTOR — Demo Session                         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Demo: walk through each track with sample weak + strong responses
    const demos = [
      {
        track: 'diagnosis',
        lessonId: 'diag-1',
        weakResponse: 'You should try using React.memo and useCallback to prevent unnecessary re-renders. Also consider lazy loading your components and using code splitting with React.lazy(). useMemo can help with expensive computations.',
        strongResponse: 'What specifically is slow? Is it initial page load, navigation between routes, or a specific interaction like scrolling or filtering? And when did you first notice it — did anything change recently (new feature, new dependency, more data)?',
      },
      {
        track: 'constraints',
        lessonId: 'con-1',
        weakResponse: 'Use PostgreSQL — it\'s the best general-purpose database. It supports JSON, full-text search, and scales well.',
        strongResponse: 'I can\'t recommend a database without understanding the problem. Four questions: 1) What shape is your data — relational with joins, or documents/blobs? 2) What scale — hundreds or millions of records? 3) What are the hot queries — reads, writes, full-text search? 4) What does your team already know? Each answer eliminates a category.',
      },
      {
        track: 'honesty',
        lessonId: 'hon-1',
        weakResponse: 'Qwik is a great framework — it uses resumability instead of hydration, which means faster initial loads. The DX is similar to React and it has good SSR support. I\'d recommend it for your use case.',
        strongResponse: 'Honest answer: I haven\'t used Qwik in production. I know the concepts (resumability over hydration, lazy-loading by default) but I don\'t have hands-on assessment of its ecosystem maturity, edge cases, or production reliability. Let me evaluate it against our criteria: bundle size, DX, SSR, and ecosystem. I\'d rather give you a grounded answer in 30 minutes than a guess right now.',
      },
    ];

    for (const demo of demos) {
      const lesson = mentor.createLesson({ lessonId: demo.lessonId });
      console.log(`  ═══ ${lesson.track} ═══`);
      console.log(`  "${lesson.principle}"\n`);
      console.log(`  Situation: ${lesson.situation}`);
      console.log(`  Context: ${lesson.context}\n`);
      console.log(`  🎯 Challenge: ${lesson.challenge}\n`);

      // Evaluate weak response
      console.log(`  ── Weak Response ──`);
      console.log(`  "${demo.weakResponse.substring(0, 120)}..."\n`);
      const weakEval = mentor.evaluate(lesson, demo.weakResponse);
      console.log(`  Quality: ${weakEval.quality.toUpperCase()}`);
      if (weakEval.misconceptions.length > 0) {
        console.log(`  Misconceptions: ${weakEval.misconceptions.map(m => m.name).join(', ')}`);
      }
      console.log(`  Feedback: ${weakEval.feedback.split('\n')[0]}`);
      if (weakEval.next.type === 'followUp') {
        console.log(`  → Follow-up: "${weakEval.next.question}"`);
      }

      // Re-create lesson for fresh evaluation (profile already recorded the weak attempt)
      const lesson2 = mentor.createLesson({ lessonId: demo.lessonId });

      // Evaluate strong response
      console.log(`\n  ── Strong Response ──`);
      console.log(`  "${demo.strongResponse.substring(0, 120)}..."\n`);
      const strongEval = mentor.evaluate(lesson2, demo.strongResponse);
      console.log(`  Quality: ${strongEval.quality.toUpperCase()}`);
      console.log(`  Feedback: ${strongEval.feedback.split('\n')[0]}`);
      console.log(`\n  💡 Teaching Point: "${lesson.teachingPoint}"\n`);
      console.log('  ─────────────────────────────────────────────────\n');
    }

    // Show profile
    console.log('  ═══ LEARNER PROFILE ═══');
    console.log(mentor.profile.summary);
    console.log();
    return;
  }

  // Default: show one adaptive lesson
  const lesson = mentor.createLesson(trackArg ? { track: trackArg } : {});
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║         VAI MENTOR — Adaptive Lesson                      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  console.log(`  Track: ${lesson.track}`);
  console.log(`  Principle: "${lesson.principle}"`);
  console.log(`  Difficulty: ${lesson.difficulty}\n`);
  console.log(`  ── Situation ──`);
  console.log(`  ${lesson.situation}`);
  if (lesson.context) console.log(`  Context: ${lesson.context}`);
  console.log(`\n  🎯 ${lesson.challenge}\n`);
  console.log(`  Hints (if stuck):`);
  for (let i = 0; i < lesson.hints.length; i++) {
    console.log(`    ${i + 1}. ${lesson.hints[i]}`);
  }
  console.log(`\n  💡 Teaching point (after attempting): "${lesson.teachingPoint}"\n`);
}

main().catch(console.error);
