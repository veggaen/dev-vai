/**
 * conversational-handler — extracted from VaiEngine (decomposition phase 2, slice 3).
 *
 * The conversational-mode handler: general chat / knowledge-gap / iteration-follow-up handling for
 * a turn. Extracted verbatim from the god-class; its 13 real (AST-confirmed, read-only) dependencies
 * are INJECTED as a `deps` object so this is a free function (no `this`). No state writes, no
 * recursion. NOTE: `this.items` in the body is inside a knowledge-string TypeScript example
 * (a Stack<T> class) — display content, NOT a dependency — and is deliberately left untouched.
 *
 * VaiEngine keeps a thin wrapper binding the deps. Extracted byte-identical (proven by golden snapshot).
 */

import type { Message } from './adapter.js';
import { KnowledgeStore, VaiTokenizer, type KnowledgeEntry } from './knowledge-store.js';
import { tryGamingCasualSnippet } from '../chat/gaming-casual-snippets.js';
import { KNOWLEDGE_RETRIEVAL_SCORE_MIN } from '../chat/chat-quality.js';
import { extractTopicFromQuery, topicContentTokens, textConcernsTopic } from '../input-normalization.js';
import { isPureConversationalTurn, hasSubstantiveQuestionAfterOpener } from './web-conclude-policy.js';

export interface ConversationalDeps {
  readonly _activeMode: string;
  readonly _hasActiveSandboxContext: boolean;
  readonly _rng: () => number;
  readonly knowledge: KnowledgeStore;
  readonly tokenizer: VaiTokenizer;
  cachedFindBestMatch(input: string): KnowledgeEntry | null;
  cachedRetrieveRelevant(query: string, topK?: number): Array<{ text: string; source: string; score: number }>;
  getStats(): { vocabSize: number; knowledgeEntries: number; ngramContexts: number; documentsIndexed: number; conceptsExtracted: number };
  generateIterationCode(verb: string, change: string, lang: string, previousCode: string): string;
  isCredibleNameIntroduction(input: string, match: RegExpMatchArray, rawName: string): boolean;
  buildKnowledgeGapReport(): string;
  tryCSFundamentals(input: string): string | null;
  tryGeneralKnowledge(input: string): string | null;
}

export function handleConversational(input: string, history: readonly Message[], deps: ConversationalDeps): string | null {
    if (
      deps._activeMode === 'builder'
      && deps._hasActiveSandboxContext
      && /\b(?:add|change|modify|update|make|convert|port|switch|remove|delete|include|insert|replace|refactor|fix|style|use|rename|polish|improve|refine|tighten)\b/i.test(input)
    ) {
      return null;
    }

    if (/\b(?:anyway|still\s+accurate|accurate\s+in\s+202\d)\b/i.test(input)) {
      return null;
    }

    if (/\b(?:go\s+deeper|ok\s+but|deeper\s+on)\b/i.test(input)) {
      const gaming = tryGamingCasualSnippet(input);
      if (gaming) return gaming;
      const anchor = input.match(/\b(?:deeper\s+on|go\s+deeper\s+on|ok\s+but)\s+(.+?)(?:\s*\(|$)/i)?.[1]?.trim();
      if (anchor) {
        const anchorLower = anchor.toLowerCase();
        const fromGeneral = deps.tryGeneralKnowledge(anchorLower);
        if (fromGeneral) return fromGeneral;
        const fromGaming = tryGamingCasualSnippet(anchorLower);
        if (fromGaming) return fromGaming;
      }
      return null;
    }

    // Filter out system messages — only count real user/assistant turns
    const conversationTurns = history.filter(m => m.role !== 'system');
    const userMessages = history.filter(m => m.role === 'user');
    const normalizedInput = input.trim().toLowerCase();
    const priorUserPool = userMessages.length > 0
      && userMessages[userMessages.length - 1].content.trim().toLowerCase() === normalizedInput
      ? userMessages.slice(0, -1)
      : userMessages;

    // ── Conversation-referential queries ──
    // "what is the (first|second|third|Nth|last) message (here|in this chat)?"
    // These are meta-questions about chat history — answer by index, never by
    // knowledge search.
    const ordinalMap: Record<string, number> = {
      first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
      sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    };
    const nthMsgMatch = input.match(/\bwhat\s+(?:is|was)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th)?)\s+(?:message|prompt|question|thing\s+i\s+(?:said|asked|wrote))\b/i);
    if (nthMsgMatch) {
      const pool = priorUserPool;
      if (pool.length === 0) {
        return "This is the first message in the chat — there isn't an earlier one to quote yet.";
      }
      const raw = nthMsgMatch[1].toLowerCase();
      let idx: number | null = null;
      if (raw === 'last') idx = pool.length - 1;
      else if (raw in ordinalMap) idx = ordinalMap[raw] - 1;
      else {
        const num = parseInt(raw, 10);
        if (!isNaN(num) && num >= 1) idx = num - 1;
      }
      if (idx !== null && idx >= 0 && idx < pool.length) {
        const target = pool[idx].content;
        return `Message ${idx + 1}: "${target}"`;
      }
      if (idx !== null && idx >= pool.length) {
        return `There are only ${pool.length} prior message${pool.length === 1 ? '' : 's'} in this chat, so there's no ${raw} one yet.`;
      }
    }

    // Greetings — includes informal Norwegian (oyoy, myyh, heia, heisann, ey, oi, fese)
    // and informal English (wassup, whaddup, yoyo, g'day, aye).
    // Guard: when the user follows the greeting with an actual question
    // (e.g. "Hello, who is the king of Norway?"), skip the greeting handler
    // so the factual question reaches the real retrieval pipeline instead of
    // bouncing back a useless "Hey! I'm VeggaAI" blurb.
    const lengthWordMap: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const wordRecallMatch = input.match(/\bwhat\s+(?:is|was|are)\s+(?:the\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[-\s]?letter\s+word\b[\s\S]*\b(?:i\s+(?:wrote|said|typed)|at\s+(?:the\s+)?(?:start|beginning)|first\s+message)\b/i);
    if (wordRecallMatch) {
      const rawLength = wordRecallMatch[1].toLowerCase();
      const targetLength = rawLength in lengthWordMap ? lengthWordMap[rawLength] : Number.parseInt(rawLength, 10);
      const referencesStart = /\b(?:start|beginning|first\s+message|first\s+thing)\b/i.test(input);
      const targetMessage = referencesStart ? priorUserPool[0] : priorUserPool[priorUserPool.length - 1];
      if (!targetMessage) {
        return "I don't have an earlier user message in this chat to inspect yet.";
      }

      const matchingWords = (targetMessage.content.match(/[a-z0-9'-]+/gi) ?? [])
        .map(word => word.trim())
        .filter(word => word.length === targetLength);

      if (matchingWords.length === 1) {
        return `You wrote "${matchingWords[0]}".`;
      }
      if (matchingWords.length > 1) {
        const uniqueWords = [...new Set(matchingWords.map(word => `"${word}"`))];
        return `I found ${uniqueWords.length} ${targetLength}-letter words in that message: ${uniqueWords.join(', ')}.`;
      }
      return `I don't see a ${targetLength}-letter word in "${targetMessage.content}".`;
    }

    if (/\bwhat\s+(?:did|do|was)\s+i\s+(?:write|say|type)\b[\s\S]*\b(?:at\s+(?:the\s+)?(?:start|beginning)|first\s+message)\b/i.test(input)) {
      if (priorUserPool.length === 0) {
        return "I don't have an earlier user message in this chat to quote yet.";
      }
      return `You started with: "${priorUserPool[0].content}".`;
    }

    const hasFactualQuestionAfterGreeting = hasSubstantiveQuestionAfterOpener(input);
    const conversationalContext = {
      activeMode: deps._activeMode,
      hasActiveSandbox: deps._hasActiveSandboxContext,
    };
    if (!hasFactualQuestionAfterGreeting && isPureConversationalTurn(input, conversationalContext)) {
      // Detect Norwegian greetings — respond in Norwegian
      const isNorwegianGreeting = /^(hei|heia|heisann|heihei|hallo|oyoy|myyh|fese|oi)(\s+\w+)?[\s!.?]*$/i.test(input);

      // Only show follow-up greeting if there's a prior exchange (user + assistant + current)
      const hasHistory = conversationTurns.length >= 3;
      if (hasHistory) {
        if (isNorwegianGreeting) {
          const norwegianFollowUps = [
            'Hei! Hva skal vi se på?',
            'Hei igjen — hva trenger du?',
            'Heisann! Hva har du på hjertet?',
            'Hei! Klar når du er.',
          ];
          return norwegianFollowUps[Math.floor(deps._rng() * norwegianFollowUps.length)];
        }
        const followUpGreetings = [
          'Hey! What are we diving into?',
          'Back at it — what\'s next?',
          'Hey! What do you need?',
          'What\'s up?',
          'Ready when you are.',
          'Hey again — go ahead.',
          'What\'s on your mind?',
        ];
        return followUpGreetings[Math.floor(deps._rng() * followUpGreetings.length)];
      }
      if (conversationTurns.length < 3) {
        if (isNorwegianGreeting) {
          if (deps._activeMode === 'builder') {
            return 'Hei - hva vil du bygge?';
          }
          if (deps._activeMode === 'agent') {
            return 'Hei - hva vil du at jeg skal ta tak i?';
          }
          return 'Hei - VeggaAI her, hva skjer?';
        }
        if (deps._activeMode === 'builder') {
          return 'Hey - what do you want to build?';
        }
        if (deps._activeMode === 'agent') {
          return 'Hey - what do you want me to tackle?';
        }
        return "Hey - VeggaAI here, what's up?";
      }
      const stats = deps.getStats();
      if (isNorwegianGreeting) {
        if (stats.knowledgeEntries > 50) {
          return `Hei! Jeg er VeggaAI — jeg har lært ${stats.knowledgeEntries} konsepter fra ${stats.documentsIndexed} kilder. Spør meg om hva som helst.`;
        }
        return 'Hei! Jeg er VeggaAI — spør meg om hva som helst, så gjør jeg mitt beste.';
      }
      if (stats.knowledgeEntries > 50) {
        return `Hey! I'm VeggaAI — I've picked up ${stats.knowledgeEntries} concepts from ${stats.documentsIndexed} sources. Ask me anything.`;
      }
      if (stats.documentsIndexed > 0) {
        return `Hey! I'm VeggaAI, running on ${stats.documentsIndexed} sources. Ask me anything — I'll search the web if I don't have it locally.`;
      }
      return 'Hey! I\'m VeggaAI — still fresh, but ask me anything and I\'ll do my best.';
    }

    // Thank you — respond in Norwegian if Norwegian input
    if (/^(takk|tusen\s*takk)[\s!.]*$/i.test(input)) {
      return 'Bare hyggelig! Si fra om det er noe mer.';
    }
    if (/^(?:ok\s+)?(?:thanks|thank\s*you(?:\s+so\s+much)?|thx|ty|cheers|much\s+appreciated|thanks?\s+(?:a\s+lot|so\s+much|bro|man|dude|mate)|that\s+(?:helped|works|did\s+it)|got\s+it|perfect|great\s+(?:thanks|help|stuff)|awesome\s+thanks)[\s!.,]*(?:(?:that|this|it)\s+(?:was|is|helped|works)[\s\w]*)?[\s!.]*$/i.test(input)) {
      return "You're welcome! Let me know if there's anything else.";
    }

    // Vague "how do I get started?" — no specific topic
    if (/^(?:how\s+(?:do|can|should)\s+i\s+)?(?:get\s+started|begin|start)(?:\s+(?:with\s+)?(?:programming|coding|learning))?[\s?!.]*$/i.test(input)) {
      return 'Get started with what? I know about **Docker**, **React**, **TypeScript**, **Git**, **Kubernetes**, **PostgreSQL**, and more.\n\nJust pick a topic — "What is Docker?" or "How do I set up TypeScript?" are great starting points.';
    }

    // "What can you do?" / "What are you capable of?" / "What do you know?"
    if (/^(?:what\s+can\s+you\s+(?:do|help\s+(?:me\s+)?with|build)|what\s+are\s+you\s+(?:capable\s+of|good\s+at)|what\s+do\s+you\s+(?:know|do)|show\s+me\s+what\s+you\s+can\s+do|what\s+(?:stuff|things)\s+can\s+you\s+do|your\s+capabilities|what(?:'s|\s+is)\s+your\s+(?:speciality|specialty)|how\s+good\s+are\s+you)[\s?!.]*$/i.test(input)) {
      const mode = deps._activeMode;
      if (mode === 'builder') {
        return `In **Builder mode** I focus on shipping code:\n\n- **Scaffold projects** — "build me a Next.js todo app", "build a PERN stack dashboard"\n- **Generate files** — complete working code with \`title="path/to/file"\` blocks the sandbox auto-applies\n- **Iterate** — "add dark mode", "add auth", "fix the API route"\n- **Debug builds** — paste an error and I'll diagnose + fix it\n\nJust tell me what to build.`;
      }
      if (mode === 'agent') {
        return `In **Agent mode** I take action:\n\n- Apply code changes directly to your sandbox\n- Debug errors end-to-end\n- Run multi-step tasks without hand-holding\n- Explain what I did and what to verify\n\nGive me a task.`;
      }
      if (mode === 'plan') {
        return `In **Plan mode** I help you think before you build:\n\n- Break any project into phases with clear done-when criteria\n- Surface hidden complexity before you hit it\n- Recommend tech choices with reasoning, not just opinions\n- Structure your approach so the implementation is obvious\n\nWhat are you planning?`;
      }
      if (mode === 'debate') {
        return `In **Debate mode** I challenge your thinking:\n\n- Steel-man then attack any position\n- Present genuine opposing perspectives with evidence\n- Surface assumptions you haven't questioned\n- Push back on weak reasoning\n\nWhat position do you want tested?`;
      }
      // Chat mode / default
      return `Here's what I can do:\n\n**Build**\n- Scaffold full projects (Next.js, PERN, MERN, T3, Vinext)\n- Generate working code files the sandbox auto-deploys\n- Iterate on existing projects: "add dark mode", "add auth"\n\n**Debug**\n- Paste any error or stack trace — I'll diagnose and fix it\n- Explain why something broke, not just how to patch it\n\n**Explain**\n- Tech concepts: Docker, TypeScript, React, APIs, databases\n- How things work at different levels of depth (quick vs deep)\n- ELI5 explanations for complex topics\n\n**Plan**\n- Break projects into phases\n- Recommend tech stacks with tradeoffs\n- Surface hidden complexity early\n\nSwitch modes in the sidebar for focused behavior: **Chat**, **Builder**, **Agent**, **Plan**, **Debate**.`;
    }

    // "What modes are there?" / "What is builder mode?" / "How do modes work?"
    if (/\b(?:what\s+(?:modes?|is\s+(?:builder|agent|plan|debate|chat)\s+mode)|(?:builder|agent|plan|debate|chat)\s+mode\s+(?:is|does|means?)|how\s+do\s+(?:modes?|this)\s+work|switch\s+(?:modes?|to)|change\s+mode)\b/i.test(input)) {
      return `**Vai has 5 modes** — switch in the sidebar:\n\n**Chat** *(default)*\nConversational. Explain concepts, answer questions, discuss ideas. No code changes unless you explicitly ask.\n\n**Builder**\nCode-first. Every response is working files the sandbox auto-applies. Built for "build me X", "add Y", "fix Z".\n\n**Agent**\nAction-first. Takes multi-step tasks, applies changes directly, reports back concisely.\n\n**Plan**\nThinks before coding. Breaks projects into phases, surfaces tradeoffs, defines done-criteria.\n\n**Debate**\nChallenge mode. Stress-tests your ideas, presents opposing views, surfaces hidden assumptions.\n\nCurrently in **${deps._activeMode.charAt(0).toUpperCase() + deps._activeMode.slice(1)} mode**.`;
    }

    // ── Casual conversation / personal questions ──
    // These should NOT fall through to TF-IDF retrieval which gives garbage results

    // "What do you think I did today?" / "Guess what I did" / "How was my day?"
    if (/(?:what\s+do\s+you\s+think\s+i\s+did|guess\s+what\s+i\s+did|how\s+was\s+my\s+day|what\s+did\s+i\s+do\s+today)/i.test(input)) {
      if (conversationTurns.length >= 3) {
        const userMsgs = history.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
        const topics = userMsgs.filter(m => m.length > 10).slice(-3);
        if (topics.length > 0) {
          return `Based on our conversation, you've been exploring ${topics.length > 1 ? 'a few things' : 'something'} with me! But I can only see what happens in this chat — I don't know what you did outside of it. Want to tell me about your day?`;
        }
      }
      return "I'd love to know! I can only see what happens in our chat, so tell me — what did you get up to today?";
    }

    // "How are you?" / "How do you feel?" / "Are you okay?"
    if (/^what'?s\s+up[\s?!.]*$/i.test(input)) {
      return "Hey — not much, just here and ready to help. What can I do for you?";
    }
    if (/^(?:how\s+are\s+you(?:\s+doing|\s+today|\s+feeling)?|how(?:'s| is)\s+it\s+going|how\s+do\s+you\s+feel|are\s+you\s+(?:ok(?:ay)?|alright|good|well)|how'?s\s+(?:your\s+day|things|life)|you\s+good|you\s+ok(?:ay)?)[\s?!.]*$/i.test(input)) {
      return "I'm running smoothly — all systems go! More importantly, what can I help you with? I'm good at coding, tech questions, building projects, and learning new things.";
    }

    // Short conversational reactions — "haha", "lol", "nice", "cool", "wow", "awesome", "great", "haha that was funny"
    const hasSubstantiveTail = /\b(?:anyway|but|still|accurate|deeper|research|what|who|how|why|when|in\s+202\d)\b|\?/i.test(input);
    const isReaction = !hasSubstantiveTail
      && (/^(?:ha+(?:ha)*|lol|lmao|rofl|nice|cool|wow|awesome|great|amazing|sweet|dope|sick|lit|fire|omg|oh\s+wow|that(?:'s|\s+is)\s+(?:funny|cool|nice|awesome|great|amazing|interesting|hilarious)|loved?\s+(?:it|that))[\s!.]*$/i.test(input)
        || (input.length < 60 && /^(?:ha+(?:ha)*|lol|lmao|rofl|nice|cool|wow|awesome|amazing|great|oh\s+wow|omg)\b/i.test(input)));
    if (isReaction) {
      return "Glad to hear it! What else can I help with?";
    }

    // "What's your name?" / "Who made you?" / "What are you?" / "How does Vai work?"
    if (/^(?:what(?:'s| is)\s+your\s+name|who\s+(?:made|created|built|are)\s+you|who\s+are\s+your?\s+(?:creator|maker|developer)|what\s+(?:are|is)\s+(?:you|vai|veggaai)|how\s+(?:does|do)\s+(?:vai|veggaai|you)\s+work|are\s+you\s+(?:ai|an\s+ai|a\s+bot|a\s+model|local|open\s+source))[\s?!.]*$/i.test(input)) {
      const stats = deps.getStats();
      return `I'm **VeggaAI** (Vai) — a local-first AI built by v3gga.\n\n**How I work:**\nI run entirely on your machine — no cloud, no data leaving your device. I use a pattern-matching + TF-IDF retrieval engine (vai:v0) that gets smarter as I learn from what you teach me.\n\n**Current state:**\n- ${stats.knowledgeEntries} knowledge entries\n- ${stats.documentsIndexed} documents indexed\n- Running in **${deps._activeMode} mode**\n\nYou can connect me to external models (Claude, GPT-4, Gemini) via the model selector — or keep using me as a fully local engine.`;
    }

    // "Do you like X?" / "What's your favorite X?" / personal preference questions
    if (/(?:do\s+you\s+(?:like|enjoy|prefer|love|hate)|what(?:'s| is)\s+your\s+(?:fav(?:ou?rite)?|preferred|go[\s-]?to))\s+(.+)/i.test(input)) {
      const topicMatch = input.match(/(?:do\s+you\s+(?:like|enjoy|prefer|love|hate)|what(?:'s| is)\s+your\s+(?:fav(?:ou?rite)?|preferred|go[\s-]?to))\s+(.+)/i);
      const subject = topicMatch?.[1]?.replace(/[?.!]+$/, '').trim() || 'that';
      return `I don't have personal preferences — I'm a pattern-matching engine! But I can give you a solid technical comparison or recommendation if you're choosing between options. What are you deciding between?`;
    }

    // "Can you help me with X?" / "I need help with X"
    if (/^(?:can\s+you\s+help(?:\s+me)?|i\s+need\s+(?:help|assistance)|help\s+me)\s+(?:with\s+)?(.+)/i.test(input)) {
      const helpMatch = input.match(/^(?:can\s+you\s+help(?:\s+me)?|i\s+need\s+(?:help|assistance)|help\s+me)\s+(?:with\s+)?(.+)/i);
      const topic = helpMatch?.[1]?.replace(/[?.!]+$/, '').trim() || '';
      if (topic) {
        return null; // Let it fall through to domain-specific handlers
      }
      return "Of course! What do you need help with? I can assist with:\n- **Coding** — generate code, debug, explain concepts\n- **Tech questions** — databases, Docker, React, APIs, etc.\n- **Building projects** — describe what you want and I'll help plan it\n- **Learning** — explain topics simply or in depth";
    }

    // "Tell me a joke" / "Say something funny"
    if (/(?:tell\s+(?:me\s+)?a\s+joke|say\s+something\s+funny|make\s+me\s+laugh|joke)/i.test(input) && input.length < 40) {
      const jokes = [
        'Why do programmers prefer dark mode? Because light attracts bugs.',
        'A SQL query walks into a bar, sees two tables, and asks: "Can I JOIN you?"',
        'There are only 10 types of people in the world: those who understand binary and those who don\'t.',
        '!false — it\'s funny because it\'s true.',
        'A programmer\'s wife says "Go to the store and get a gallon of milk. If they have eggs, get a dozen." He comes home with 12 gallons of milk.',
      ];
      return jokes[Math.floor(deps._rng() * jokes.length)];
    }

    // "I'm bored" / "What should I do?" / "I don't know what to ask"
    if (/^(?:i(?:'m| am)\s+bored|what\s+should\s+i\s+(?:do|ask|try)|i\s+don'?t\s+know\s+what\s+to\s+(?:ask|do|try)|nothing\s+(?:specific|particular)|just\s+chatting)[\s?!.]*$/i.test(input)) {
      const suggestions = [
        "Here are some ideas:\n- Ask me to **build something** — \"Build me a todo app in React\"\n- **Learn something new** — \"Explain Kubernetes like I'm 5\"\n- **Compare technologies** — \"Redis vs Memcached\"\n- **Deep dive** — \"How does a database index work?\"\n- Say **\"google [topic]\"** to search the web and teach me",
        "Try one of these:\n- \"What's the best database for my project?\"\n- \"Build me a REST API with Express\"\n- \"Explain microservices\"\n- \"How do I set up CI/CD?\"\n- Or teach me something new — I learn from everything you tell me!",
      ];
      return suggestions[Math.floor(deps._rng() * suggestions.length)];
    }

    // "Yes" / "No" / "Sure" / "Okay" — short affirmations
    if (/^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|alright|nah|nope|no|not\s+really)[\s!.]*$/i.test(input)) {
      if (conversationTurns.length >= 3) {
        const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
        if (lastAssistant) {
          const hasQuestion = lastAssistant.content.includes('?');
          const isGreeting = /veggaai|ask me anything|what.*start|what.*help|what.*need/i.test(lastAssistant.content);
          if (hasQuestion || isGreeting) {
            // Last message asked a question or was a greeting — acknowledge and continue
            if (/^(?:yes|yeah|yep|yup|sure|ok|okay|alright)[\s!.]*$/i.test(input)) {
              return "Great! Go ahead — what would you like to know or build?";
            } else {
              return "No problem. What else can I help you with?";
            }
          }
        }
      }
      // No prior context — give a neutral response instead of falling through to garbage TF-IDF
      if (/^(?:yes|yeah|yep|yup|sure|ok|okay|alright)[\s!.]*$/i.test(input)) {
        return "What would you like to work on? I can build projects, explain concepts, debug errors, or discuss tech topics.";
      } else {
        return "No worries. What can I help you with? I can build projects, explain concepts, debug errors, or discuss tech topics.";
      }
    }

    // "what about X?" with any prior message — topic follow-up
    const earlyWhatAbout = input.match(/^what\s+about\s+(.+?)[\s?.!]*$/i);
    if (earlyWhatAbout) {
      const subtopic = earlyWhatAbout[1].trim().toLowerCase();
      const lastAsstMsg = conversationTurns.filter(m => m.role === 'assistant').slice(-1)[0];
      if (lastAsstMsg) {
        const prevLower = lastAsstMsg.content.toLowerCase();
        const inferredTopic = lastAsstMsg.content.match(/\*\*([^*]+)\*\*/)?.[1]?.replace(/[*:]/g, '').trim().toLowerCase() || '';
        // Check the inline subtopicMap for common tech + subtopic combos
        const quickSubtopics: Record<string, Record<string, string>> = {
          'kubernetes': {
            'security': '**Kubernetes security:**\n\n- **RBAC** — Role-Based Access Control: define who can do what to which resources\n- **Network Policies** — restrict pod-to-pod traffic; deny-all then allow explicitly\n- **Secrets** — use External Secrets Operator or HashiCorp Vault (not just `kubectl create secret` which is base64-only)\n- **Pod security** — `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, drop all capabilities\n- **Image scanning** — scan with Trivy/Snyk, use signed images, private registries only\n- **Audit logs** — enable API server audit logging for compliance\n\nThe biggest risk: over-permissioned service accounts and images running as root.',
            'networking': '**Kubernetes networking:**\n\nService types: **ClusterIP** (internal), **NodePort** (external port on each node), **LoadBalancer** (cloud LB), **Ingress** (HTTP routing).\n\nEvery pod gets its own IP. Services provide stable DNS names. Use `Ingress` for HTTP routing with TLS termination.\n\nNetwork Policies control pod-to-pod traffic. By default all pods can reach all pods — lock this down in production.',
            'monitoring': '**Kubernetes monitoring:**\n\nStandard stack: **Prometheus** (metrics) + **Grafana** (dashboards) + **Alertmanager** (alerts).\n\nKey commands:\n```bash\nkubectl top nodes\nkubectl top pods\nkubectl describe pod <pod>  # shows events + conditions\nkubectl logs <pod> -f       # stream logs\n```\n\n**Liveness probe** — restarts unhealthy containers. **Readiness probe** — removes from service if not ready.',
          },
          'docker': {
            'security': '**Docker security:**\n\n1. **Don\'t run as root** — add `USER node` to Dockerfile\n2. **Use minimal base images** — `alpine` or `distroless`\n3. **Scan images** — `docker scout cves` or Trivy\n4. **Don\'t bake secrets** — use `--secret` flag or runtime env vars\n5. **Drop capabilities** — `--cap-drop ALL`\n6. **Multi-stage builds** — don\'t ship build tools in production image\n7. **Pin versions** — `node:20.11-alpine` not `node:latest`',
            'networking': '**Docker networking:**\n\n- `bridge` (default) — containers on same host can talk\n- `host` — shares host network stack\n- `overlay` — multi-host (Swarm/K8s)\n\nContainers on the same user-defined network resolve each other by name: `http://app2:3000`.',
          },
          'react': {
            'performance': '**React performance:**\n\n1. `React.memo()` — skip re-renders when props unchanged\n2. `useMemo()` — cache expensive computed values\n3. `useCallback()` — stable refs for child components\n4. `React.lazy()` — code splitting for heavy components\n5. `react-window` — virtualize long lists\n6. **Avoid unnecessary state lifting** — keep state close to where it\'s used\n7. **React DevTools Profiler** — find what\'s slow',
            'testing': '**React testing with Testing Library:**\n\n```tsx\nimport { render, screen, fireEvent } from "@testing-library/react";\ntest("increments counter", () => {\n  render(<Counter />);\n  fireEvent.click(screen.getByText("+1"));\n  expect(screen.getByText("Count: 1")).toBeInTheDocument();\n});\n```\n\nPrinciple: test behavior, not implementation. Query by role/label, not test IDs.',
          },
        };
        for (const [mainTopic, subtopics] of Object.entries(quickSubtopics)) {
          if (prevLower.includes(mainTopic) || inferredTopic.includes(mainTopic)) {
            for (const [subKey, content] of Object.entries(subtopics)) {
              if (subtopic.includes(subKey) || subKey.includes(subtopic.replace(/\s+in\s+\w+$/i, '').trim())) {
                return content;
              }
            }
          }
        }
        // Try CS fundamentals for the subtopic
        const csA = deps.tryCSFundamentals(`how does ${subtopic} work`);
        if (csA) return csA;
        const csB = deps.tryCSFundamentals(`what is ${subtopic}`);
        if (csB) return csB;
        // Try knowledge for the subtopic in context of last discussion
        const match = deps.cachedFindBestMatch(inferredTopic ? `${inferredTopic} ${subtopic}` : subtopic);
        if (match && match.response.length > 50 && !KnowledgeStore.isJunkContent(match.response)) {
          return `**${subtopic.charAt(0).toUpperCase() + subtopic.slice(1)}:**\n\n${match.response}`;
        }
      }
    }

    // "continue" / "tell me more" / "go on" — with any prior assistant message (even 1)
    if (/^(?:continue|go\s+on|keep\s+going|tell\s+me\s+more|more\s+(?:please|info|details?|about\s+(?:that|this))|and\?+|elaborate)[\s!.]*$/i.test(input)) {
      const allAssistantMsgs = conversationTurns.filter(m => m.role === 'assistant');
      const lastAssistantMsg = allAssistantMsgs.reverse().find(m => m.content.length > 20) ?? allAssistantMsgs[0];
      if (lastAssistantMsg) {
        const prevContent = lastAssistantMsg.content;
        const prevTopic = prevContent.match(/\*\*([^*]+)\*\*/)?.[1]?.replace(/[*:]/g, '').trim().toLowerCase() || '';
        // Try to get deeper knowledge on the topic
        const searchTopic = prevTopic || prevContent.replace(/\*\*/g, '').split(/\s+/).filter(w => w.length > 4).slice(0, 3).join(' ');
        const deeper = deps.cachedRetrieveRelevant(searchTopic + ' details', 2);
        const deeperPieces = deeper.filter(d => d.score > 0.005 && !KnowledgeStore.isJunkContent(d.text) && d.text.length > 80);
        if (deeperPieces.length > 0) {
          const piece = deeperPieces[0].text;
          const sentences = piece.split(/(?<=[.!?])\s+/).filter(s => s.length > 20).slice(0, 5);
          if (sentences.length >= 2) {
            return `**Continuing${prevTopic ? ` on ${prevTopic}` : ''}:**\n\n${sentences.join(' ')}\n\nWant to go deeper? Ask about a specific aspect.`;
          }
        }
        // Synthesize by presenting the second half of the previous answer
        const prevSections = prevContent.split(/\n\n+/).filter(s => s.length > 40);
        if (prevSections.length > 2) {
          const continuation = prevSections.slice(Math.floor(prevSections.length / 2)).join('\n\n');
          if (continuation.length > 100) {
            return `**More${prevTopic ? ` on ${prevTopic}` : ''}:**\n\n${continuation.slice(0, 600)}${continuation.length > 600 ? '\n\n...' : ''}`;
          }
        }
        if (prevTopic) {
          return `Here's more I can tell you about **${prevTopic}**:\n\nTry asking:\n- "Why does ${prevTopic} work this way?"\n- "Give me a ${prevTopic} example"\n- "What are best practices for ${prevTopic}?"\n- "How does ${prevTopic} compare to alternatives?"`;
        }
      }
    }

    // Orphan follow-ups — user says "explain more" but there's truly NO prior context
    const orphanFollowUp = /(?:explain|tell|say)\s+(?:(?:me|it|that|this)\s+)?(?:more|(?:more\s+)?simply|simpler)|more\s+detail|elaborate|can you.*(?:break.*down|go deeper|expand)|more about that/i;
    const hasPriorAssistantMsg = conversationTurns.some(m => m.role === 'assistant' && m.content.length > 30);
    if (!hasPriorAssistantMsg && orphanFollowUp.test(input)) {
      return 'I\'d be happy to explain more — but I\'m not sure what you\'re referring to. Could you tell me the topic? For example: "Explain Docker more simply" or "Tell me more about TypeScript."';
    }

    // Conversational follow-ups — reference previous assistant response (needs >= 1 prior assistant msg)
    if (conversationTurns.length >= 2) {
      // Find last MEANINGFUL assistant message (skip short reactions like "Glad to hear it!")
      const allAssistantMsgs = [...history].filter(m => m.role === 'assistant').reverse();
      const lastAssistant = allAssistantMsgs.find(m => m.content.length > 80) || allAssistantMsgs[0];
      if (lastAssistant) {
        const followUp = /(?:explain|say).*(?:more simply|simpler|easier|in simple|plain)|simplify|eli5|explain.*like.*(?:5|five|child|beginner)|can you.*(?:break.*down|dumb.*down)/i;
        const exampleReq = /(?:show|give|provide).*(?:example|sample|demo)|can you.*(?:example|demonstrate|illustrate)/i;
        const moreDetail = /(?:tell|explain|say).*more|more detail|elaborate|go deeper|expand on|continue|keep going|go on|and\?+/i;

        if (followUp.test(input)) {
          // Genuinely simplify the previous answer — not just truncate
          const prev = lastAssistant.content;
          // Extract core topic from the previous answer's first line/heading
          const headingMatch = prev.match(/\*\*([^*]+)\*\*/);
          let topic = headingMatch ? headingMatch[1].replace(/[*:]/g, '').trim().toLowerCase() : '';
          // If no heading in last message (e.g. it was a code example), scan earlier assistant messages
          if (!topic) {
            for (const msg of allAssistantMsgs.slice(1)) {
              const h = msg.content.match(/\*\*([^*]+)\*\*/);
              if (h) { topic = h[1].replace(/[*:]/g, '').trim().toLowerCase(); break; }
            }
          }

          // Try to produce a real ELI5 for known topics
          const eli5Map: Record<string, string> = {
            'docker': 'Think of Docker like a **shipping container** for software. Just like a physical container holds goods that can be moved on any truck or ship, a Docker container packages your app with everything it needs to run — so it works the same way on any computer.\n\n**In 3 steps:** Write a recipe (Dockerfile) → Build a package (Image) → Run it anywhere (Container).',
            'kubernetes': 'If Docker is a single shipping container, **Kubernetes is the port manager** — it decides where to put containers, replaces broken ones, and scales up when traffic increases.\n\n**Think of it as:** You tell K8s "I want 3 copies of my app running" and it handles everything — scheduling, healing, load balancing.',
            'react': 'React lets you build web pages from **reusable building blocks** called components. Each component is a piece of UI (a button, a form, a card) that manages its own data and can be composed together like LEGO bricks.',
            'typescript': 'TypeScript is JavaScript with **spell-check for your code**. Just like a spell-checker catches typos before you send an email, TypeScript catches bugs before you run your program. It\'s the same JavaScript underneath — just safer.',
            'git': 'Git is like an **unlimited undo button** for your code. Every time you save a checkpoint (commit), you can always go back. Branches let you try experiments without breaking the main version.',
            'ci/cd': 'CI/CD is like a **factory assembly line** for your code. Every time you push code, a robot (CI) checks it for errors and runs tests. If everything passes, another robot (CD) delivers it straight to your users — no manual steps needed.',
            'postgresql': 'PostgreSQL is like a **super-organized filing cabinet** for your data. You define how your data is structured (tables), and Postgres makes sure every piece of data follows the rules, finds things fast using indexes, and never loses anything — even if the power goes out.',
            'postgres': 'PostgreSQL is like a **super-organized filing cabinet** for your data. You define how your data is structured (tables), and Postgres makes sure every piece of data follows the rules, finds things fast, and never loses anything.',
            'microservice': 'Imagine a **restaurant kitchen**. A monolith is one chef doing everything — cooking, plating, cleaning. Microservices split the kitchen into stations — one for grilling, one for salads, one for desserts. Each station works independently, can be replaced without shutting down the kitchen, and can scale (add more grill chefs on busy nights).',
            'rust': 'Rust is like driving a **race car with guardrails**. It\'s incredibly fast (like C/C++), but the compiler acts as a co-pilot that physically prevents you from crashing — no null pointers, no data races, no memory leaks. If it compiles, it\'s safe.',
            'graphql': 'REST is like ordering a **set menu** — you get everything on the plate whether you want it or not. GraphQL is like a **buffet** — you pick exactly what you want, nothing more, nothing less. One endpoint, you describe what data you need, and you get exactly that.',
            'redis': 'Redis is like a **sticky note board** next to your database filing cabinet. Instead of opening the cabinet every time (slow), you write frequently needed answers on sticky notes (Redis cache). Lightning fast reads, but the notes disappear if the power goes out (unless you configure persistence).',
            'mongodb': 'Think of MongoDB like a **box of folders** instead of a spreadsheet. In SQL, every row must have the exact same columns. In MongoDB, each document (folder) can have different fields — perfect for messy, evolving data that doesn\'t fit neatly into rows and columns.',
            'jwt': 'A **JWT (JSON Web Token)** is like a **signed ID card**. When you log in, the server hands you a card with your name and permissions stamped on it. Every time you make a request, you show the card — the server just checks the stamp (signature) instead of looking you up in a database.\n\n**3 parts:** Header (algorithm) + Payload (your data/claims) + Signature (proof it\'s real) — joined by dots: `header.payload.signature`.',
            'oauth': '**OAuth** is like giving someone a **hotel key card** instead of your house key. You let an app (say, a photo editor) access your Google Photos without giving it your Google password. Google issues a temporary key card with limited access — the app can open the photo door but not your email.\n\n**Flow:** App asks Google → You approve → Google issues a token → App uses token.',
            'tcp': '**TCP** is like sending a **registered letter** — the post office confirms delivery, resends if lost, and makes sure letters arrive in order. **UDP** is like a **postcards** — fast, no confirmation, some may go missing.\n\nUse TCP for: web pages, emails, file transfers. Use UDP for: video calls, games, live streams (speed > reliability).',
            'dns': '**DNS** is the internet\'s **phone book**. When you type "google.com", DNS translates that human-readable name into an IP address (142.250.80.46) that computers use to actually find each other.\n\n**Analogy:** You know your friend by name (google.com), but your phone needs their number (IP) to call them.',
            'sql injection': '**SQL Injection** is tricking a database by sneaking commands through user input. A login form checks: WHERE username = \'admin\' AND password = \'...\'. If you type \' OR \'1\'=\'1 as the password, the query becomes always-true and you\'re in.\n\n**Fix:** Use prepared statements/parameterized queries — never concatenate user input directly into SQL.',
          };

          // Check if previous topic matches any ELI5
          for (const [key, explanation] of Object.entries(eli5Map)) {
            if (topic.includes(key) || prev.toLowerCase().includes(key)) {
              return explanation;
            }
          }
          // Fallback: if topic is still unresolved, check earlier history (e.g. after a code example reply)
          if (!topic) {
            const earlierHistory = allAssistantMsgs.slice(1).map(m => m.content.toLowerCase()).join(' ');
            for (const [key, explanation] of Object.entries(eli5Map)) {
              if (earlierHistory.includes(key)) {
                return explanation;
              }
            }
          }

          // Fallback: try knowledge retrieval for a simpler explanation
          const topicWords = prev.replace(/\*\*/g, '').split(/\s+/)
            .filter(w => w.length > 3 && !KnowledgeStore.STOP_WORDS.has(w.toLowerCase()) && !/^[\*\|`#\-]/.test(w))
            .slice(0, 4);
          if (topicWords.length > 0) {
            const kResults = deps.cachedRetrieveRelevant(topicWords.join(' '), 2);
            if (kResults.length > 0 && kResults[0].score > 0.01) {
              const chunk = kResults[0].text;
              // Take the first 2-3 sentences as a simpler summary
              const simpleSentences = chunk.split(/(?<=[.!?])\s+/).filter(s => s.length > 15).slice(0, 3);
              if (simpleSentences.length > 0) {
                return `In simpler terms: ${simpleSentences.join(' ')}`;
              }
            }
          }

          // Last resort: strip formatting from previous answer and extract core idea
          const stripped = prev.replace(/\*\*/g, '').replace(/```[\s\S]*?```/g, '')
            .replace(/\|[^\n]*\|/g, '').replace(/\n{2,}/g, '\n').trim();
          const sentences = stripped.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
          if (sentences.length >= 2) {
            return `In simpler terms: ${sentences[0]} ${sentences[1]}`;
          }
          if (sentences.length === 1) {
            return `In simpler terms: ${sentences[0]}`;
          }
        }

        if (exampleReq.test(input)) {
          // Extract code blocks from previous answer
          const prev = lastAssistant.content;
          const codeBlocks = prev.match(/```[\s\S]*?```/g);
          if (codeBlocks && codeBlocks.length > 0) {
            return `Here's the key example from what I just explained:\n\n${codeBlocks[0]}`;
          }
          // No code in previous answer — detect topic and provide a concrete example
          const headingMatch = prev.match(/\*\*([^*]+)\*\*/);
          const topic = headingMatch ? headingMatch[1].replace(/[*:]/g, '').trim().toLowerCase() : '';

          const exampleMap: Record<string, string> = {
            'docker': '**Docker example — a simple Node.js app:**\n\n```dockerfile\n# Dockerfile\nFROM node:20-alpine      # Start from a small Linux + Node.js image\nWORKDIR /app              # All commands run from /app\nCOPY package.json .       # Copy dependencies list first (better caching)\nRUN npm install           # Install dependencies\nCOPY . .                  # Copy your source code\nCMD ["node", "index.js"]  # The command that runs when the container starts\n```\n\n```bash\n# Build the image and run it\ndocker build -t my-app .          # Creates an image called "my-app"\ndocker run -p 3000:3000 my-app    # Maps port 3000 on your machine to 3000 in the container\n```\n\nTry changing `index.js`, rebuild, and the container picks up the change. That\'s the Docker workflow.',
            'kubernetes': '**Kubernetes example — deploying 3 replicas:**\n\n```yaml\n# deployment.yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: my-app\n  template:\n    metadata:\n      labels:\n        app: my-app\n    spec:\n      containers:\n      - name: my-app\n        image: my-app:latest\n        ports:\n        - containerPort: 3000\n```\n\n```bash\nkubectl apply -f deployment.yaml\nkubectl get pods\n```',
            'react': '**React example — a counter component:**\n\n```tsx\nimport { useState } from "react";\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(c => c + 1)}>+1</button>\n    </div>\n  );\n}\n```',
            'typescript': '**TypeScript example:**\n\n```typescript\ninterface User {\n  name: string;\n  age: number;\n  email?: string; // optional\n}\n\nfunction greet(user: User): string {\n  return `Hello, ${user.name}!`;\n}\n\nconst user: User = { name: "Alice", age: 30 };\nconsole.log(greet(user)); // "Hello, Alice!"\n```',
            'git': '**Git example — typical feature workflow:**\n\n```bash\ngit checkout -b feature/add-login   # create branch\n# ... make changes ...\ngit add .\ngit commit -m "Add login page"\ngit push origin feature/add-login\n# Create PR on GitHub, get review, merge\ngit checkout main\ngit pull\n```',
            'rest': '**REST API example with Express.js:**\n\n```javascript\nimport express from "express";\nconst app = express();\napp.use(express.json());\n\nlet users = [{ id: 1, name: "Alice" }];\n\napp.get("/api/users", (req, res) => res.json(users));\napp.post("/api/users", (req, res) => {\n  const user = { id: users.length + 1, ...req.body };\n  users.push(user);\n  res.status(201).json(user);\n});\n\napp.listen(3000);\n```',
            'ci/cd': '**GitHub Actions CI/CD example:**\n\n```yaml\n# .github/workflows/ci.yml\nname: CI/CD\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n      - run: npm ci\n      - run: npm test\n      - run: npm run build\n      - name: Deploy\n        if: github.ref == \'refs/heads/main\'\n        run: npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }}\n```\n\nEvery push runs tests; merges to main auto-deploy.',
            'postgresql': '**PostgreSQL example:**\n\n```sql\n-- Create a table\nCREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE,\n  metadata JSONB DEFAULT \'{}\',\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);\n\n-- Insert data\nINSERT INTO users (name, email, metadata)\nVALUES (\'Alice\', \'alice@example.com\', \'{"role": "admin"}\');\n\n-- Query with JSONB\nSELECT * FROM users WHERE metadata->>\'role\' = \'admin\';\n\n-- Full-text search\nSELECT * FROM users WHERE to_tsvector(name) @@ to_tsquery(\'Alice\');\n```',
            'postgres': '**PostgreSQL example:**\n\n```sql\nCREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE,\n  metadata JSONB DEFAULT \'{}\'\n);\n\nINSERT INTO users (name, email) VALUES (\'Alice\', \'alice@example.com\');\nSELECT * FROM users WHERE email = \'alice@example.com\';\n```',
            'microservice': '**Microservices example — Express.js service:**\n\n```javascript\n// user-service/index.js (Port 3001)\nimport express from "express";\nconst app = express();\napp.use(express.json());\n\nconst users = new Map();\napp.post("/users", (req, res) => {\n  const user = { id: crypto.randomUUID(), ...req.body };\n  users.set(user.id, user);\n  res.status(201).json(user);\n});\napp.get("/users/:id", (req, res) => {\n  const user = users.get(req.params.id);\n  user ? res.json(user) : res.status(404).json({ error: "Not found" });\n});\napp.listen(3001);\n```\n\n```yaml\n# docker-compose.yml\nservices:\n  user-service:\n    build: ./user-service\n    ports: ["3001:3001"]\n  order-service:\n    build: ./order-service\n    ports: ["3002:3002"]\n```',
            'graphql': '**GraphQL example with Apollo Server:**\n\n```typescript\nimport { ApolloServer } from "@apollo/server";\nimport { startStandaloneServer } from "@apollo/server/standalone";\n\nconst typeDefs = `\n  type User { id: ID!, name: String!, email: String }\n  type Query { users: [User!]!, user(id: ID!): User }\n`;\n\nconst resolvers = {\n  Query: {\n    users: () => db.users.findAll(),\n    user: (_, { id }) => db.users.findById(id),\n  },\n};\n\nconst server = new ApolloServer({ typeDefs, resolvers });\nconst { url } = await startStandaloneServer(server, { listen: { port: 4000 } });\n```\n\n```graphql\n# Client query — ask for exactly what you need\nquery { user(id: "1") { name email } }\n```',
            'redis': '**Redis example with Node.js:**\n\n```typescript\nimport { createClient } from "redis";\n\nconst client = createClient();\nawait client.connect();\n\n// String (cache)\nawait client.set("user:1", JSON.stringify({ name: "Alice" }), { EX: 3600 });\nconst user = JSON.parse(await client.get("user:1"));\n\n// Hash\nawait client.hSet("session:abc", { userId: "1", role: "admin" });\nconst session = await client.hGetAll("session:abc");\n\n// Sorted set (leaderboard)\nawait client.zAdd("scores", { score: 100, value: "alice" });\nconst top = await client.zRangeWithScores("scores", 0, 9, { REV: true });\n```',
            'mongodb': '**MongoDB example with Mongoose:**\n\n```typescript\nimport mongoose from "mongoose";\nawait mongoose.connect("mongodb://localhost:27017/myapp");\n\nconst userSchema = new mongoose.Schema({\n  name: { type: String, required: true },\n  email: { type: String, unique: true },\n  tags: [String],\n  profile: mongoose.Schema.Types.Mixed, // flexible sub-document\n});\nconst User = mongoose.model("User", userSchema);\n\n// Create\nawait User.create({ name: "Alice", email: "alice@ex.com", tags: ["admin"] });\n\n// Query\nconst admins = await User.find({ tags: "admin" }).limit(10);\n```',
          };

          for (const [key, example] of Object.entries(exampleMap)) {
            if (topic.includes(key) || prev.toLowerCase().includes(key)) {
              return example;
            }
          }

          // Last resort: search knowledge for an example
          const topicWords = prev.split(/\s+/).filter(w => w.length > 4 && !KnowledgeStore.STOP_WORDS.has(w.toLowerCase())).slice(0, 3);
          if (topicWords.length > 0) {
            const match = deps.cachedFindBestMatch(`example ${topicWords.join(' ')}`);
            if (match) return match.response;
          }
          return `I don't have a specific example ready, but try asking: "show me a [topic] example" with the specific topic you want to see.`;
        }

        if (moreDetail.test(input)) {
          // If asking about a specific subtopic (e.g. "tell me more about pods"), let the
          // context-aware subtopic handler below handle it instead of giving generic response
          const specificSubtopic = input.match(/(?:more\s+about|more\s+on|more\s+regarding)\s+(\w[\w\s]{1,30})/i);
          if (specificSubtopic) {
            // Fall through to context-aware handlers below
          } else {
          // Extract topic from previous answer heading
          const prev = lastAssistant.content;
          const headingMatch = prev.match(/\*\*([^*]+)\*\*/);
          const topic = headingMatch ? headingMatch[1].replace(/[*:]/g, '').trim().toLowerCase() : '';

          const detailMap: Record<string, string> = {
            'docker': '**Docker — deeper dive:**\n\n**Image layers:** Each Dockerfile instruction creates a layer. Layers are cached — put frequently changing code (COPY . .) last.\n\n**Networking:** Containers communicate via Docker networks. `docker network create my-net` → `docker run --network my-net`.\n\n**Volumes:** Persist data outside containers: `docker run -v mydata:/app/data`.\n\n**Multi-stage builds:** Separate build and runtime stages to keep images small:\n```dockerfile\nFROM node:20 AS builder\nRUN npm run build\nFROM node:20-alpine\nCOPY --from=builder /app/dist ./dist\n```\n\n**Health checks:** `HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1`',
            'kubernetes': '**Kubernetes — deeper dive:**\n\n**Pod lifecycle:** Pending → Running → Succeeded/Failed. K8s restarts failed pods automatically.\n\n**Services:** ClusterIP (internal), NodePort (external port), LoadBalancer (cloud LB), Ingress (HTTP routing rules).\n\n**Scaling:**\n```bash\nkubectl scale deployment my-app --replicas=5\n# Or use HorizontalPodAutoscaler for auto-scaling\n```\n\n**ConfigMaps & Secrets:** Store config outside containers. Secrets are base64-encoded (use external secrets for production).\n\n**Namespaces:** Isolate resources: `kubectl create namespace staging`.',
            'react': '**React — deeper dive:**\n\n**Component patterns:** Container/presentational, compound components, render props, higher-order components (HOCs).\n\n**Performance:** Use `React.memo()` for expensive renders, `useMemo` for computed values, `useCallback` for stable references.\n\n**State management tiers:**\n- Local: `useState`\n- Shared: Context + `useReducer`\n- Global: Zustand, Redux Toolkit, Jotai\n\n**Rendering:** React batches state updates. Use Suspense + lazy() for code splitting. Server Components (Next.js) reduce client JS.',
            'typescript': '**TypeScript — deeper dive:**\n\n**Utility types:** `Partial<T>`, `Required<T>`, `Pick<T, K>`, `Omit<T, K>`, `Record<K, V>`.\n\n**Generics:**\n```typescript\nfunction first<T>(arr: T[]): T | undefined {\n  return arr[0];\n}\n```\n\n**Discriminated unions:**\n```typescript\ntype Result = { ok: true; data: string } | { ok: false; error: string };\n```\n\n**Type guards:** `if ("data" in result)` narrows the type automatically.\n\n**Strict mode:** Enable `strict: true` in tsconfig for maximum safety.',
            'git': '**Git — deeper dive:**\n\n**Interactive rebase:** `git rebase -i HEAD~3` to squash, reorder, or edit commits.\n\n**Stashing:** `git stash` saves work-in-progress, `git stash pop` restores it.\n\n**Cherry-pick:** `git cherry-pick <sha>` applies a specific commit to current branch.\n\n**Bisect:** `git bisect start` → `git bisect bad` → `git bisect good <sha>` to binary-search for a bug.\n\n**Hooks:** `.git/hooks/pre-commit` runs before each commit (lint, test).',
            'ci/cd': '**CI/CD — deeper dive:**\n\n**Pipeline stages:** Lint → Test → Build → Deploy (staging) → Deploy (production).\n\n**Caching:** Cache `node_modules` and build artifacts between runs to speed pipelines 2-5x.\n\n**Parallelism:** Run lint, unit tests, and integration tests in parallel jobs.\n\n**Branch strategies:**\n- `main` → auto-deploy to production\n- `develop` → auto-deploy to staging\n- Feature branches → run tests on PR\n\n**Secrets:** Never hardcode. Use GitHub Secrets, Vault, or cloud secret managers.\n\n**Rollback:** Keep previous deployment artifacts. Blue-green or canary deployments for safe rollouts.',
            'postgresql': '**PostgreSQL — deeper dive:**\n\n**JSONB indexing:** `CREATE INDEX idx ON table USING GIN (data);` — query JSON fields at near-SQL speed.\n\n**Window functions:**\n```sql\nSELECT name, salary, RANK() OVER (ORDER BY salary DESC) AS rank FROM employees;\n```\n\n**CTEs (Common Table Expressions):**\n```sql\nWITH active AS (SELECT * FROM users WHERE active = true)\nSELECT * FROM active WHERE created_at > NOW() - INTERVAL \'30 days\';\n```\n\n**Extensions:** pgvector (AI embeddings), PostGIS (geospatial), pg_trgm (fuzzy search), pg_stat_statements (query analysis).\n\n**Performance:** Use `EXPLAIN ANALYZE` to find slow queries. Add indexes on frequently filtered columns.',
            'postgres': '**PostgreSQL — deeper dive:**\n\n**JSONB:** Store and index JSON data natively — faster than MongoDB for many use cases.\n\n**Extensions:** pgvector, PostGIS, pg_trgm. Install with `CREATE EXTENSION pgvector;`\n\n**Performance:** `EXPLAIN ANALYZE` your queries. Index filtered columns. Use connection pooling (PgBouncer).',
            'microservice': '**Microservices — deeper dive:**\n\n**Communication patterns:**\n- **Synchronous:** REST, gRPC (faster, typed)\n- **Asynchronous:** Message queues (RabbitMQ, Kafka) — decoupled, resilient\n\n**Key patterns:**\n- **API Gateway** — single entry point, routes to services\n- **Circuit Breaker** — prevent cascading failures\n- **Saga** — distributed transactions across services\n- **Event Sourcing** — store events, not just current state\n- **CQRS** — separate read and write models\n\n**Observability:** Distributed tracing (Jaeger), centralized logging (ELK), metrics (Prometheus + Grafana).\n\n**When NOT to use:** Small teams, simple domains, early-stage products.',
            'graphql': '**GraphQL — deeper dive:**\n\n**Mutations:**\n```graphql\nmutation { createUser(name: "Alice", email: "a@b.com") { id name } }\n```\n\n**Subscriptions:** Real-time updates via WebSocket.\n\n**N+1 problem:** Use DataLoader to batch and cache database queries per request.\n\n**Federation:** Split a large GraphQL schema across multiple services (Apollo Federation).\n\n**Code generation:** `graphql-codegen` generates TypeScript types from your schema automatically.\n\n**Caching:** Apollo Client uses normalized caching — updates propagate across all queries referencing the same entity.',
            'redis': '**Redis — deeper dive:**\n\n**Data structures:**\n- **Strings** — cache, counters (`INCR`)\n- **Hashes** — objects/sessions\n- **Lists** — queues, recent items\n- **Sets** — unique collections, intersections\n- **Sorted sets** — leaderboards, time-series\n- **Streams** — event logs, pub/sub\n\n**Persistence:** RDB (snapshots) or AOF (append-only file) for durability.\n\n**Pub/Sub:** `SUBSCRIBE channel` / `PUBLISH channel message` for real-time messaging.\n\n**TTL:** `SET key value EX 3600` — auto-expire after 1 hour.\n\n**Use cases:** Caching, session storage, rate limiting, leaderboards, real-time analytics, message queues.',
            'mongodb': '**MongoDB — deeper dive:**\n\n**Aggregation pipeline:**\n```javascript\ndb.orders.aggregate([\n  { $match: { status: "completed" } },\n  { $group: { _id: "$userId", total: { $sum: "$amount" } } },\n  { $sort: { total: -1 } },\n  { $limit: 10 }\n]);\n```\n\n**Indexes:** `db.users.createIndex({ email: 1 }, { unique: true })` — compound, text, geospatial indexes.\n\n**Transactions:** Multi-document ACID transactions supported since v4.0.\n\n**Schema validation:** Enforce structure with JSON Schema validators despite being "schema-less".\n\n**When to use:** Flexible/evolving schemas, document-oriented data, rapid prototyping, content management.',
          };

          for (const [key, detail] of Object.entries(detailMap)) {
            if (topic.includes(key) || prev.toLowerCase().includes(key)) {
              return detail;
            }
          }

          // Fallback: search knowledge entries (NOT raw TF-IDF documents) for more on the topic
          const topicWords = prev.split(/\s+/)
            .filter(w => w.length > 3 && !KnowledgeStore.STOP_WORDS.has(w.toLowerCase()) && !/^[\*\|`#\-]/.test(w))
            .slice(0, 3);
          if (topicWords.length > 0) {
            const match = deps.cachedFindBestMatch(topicWords.join(' '));
            if (match && match.response.length > 50) {
              return `Here's more on that topic:\n\n${match.response}`;
            }
          }
          return null;
        } // close else for specific subtopic skip
        }

        // "What about X?" — sub-topic follow-up referencing previous conversation
        const whatAboutMatch = input.match(/what\s+about\s+(.+)/i);
        if (whatAboutMatch) {
          const subtopic = whatAboutMatch[1].replace(/[?.!]+$/, '').trim().toLowerCase();
          const prev = lastAssistant.content.toLowerCase();

          // Build subtopic map keyed by [mainTopic][subtopic]
          const subtopicMap: Record<string, Record<string, string>> = {
            'kubernetes': {
              'security': '**Kubernetes security:**\n\n**1. RBAC (Role-Based Access Control):**\n```yaml\napiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: pod-reader\nrules:\n- apiGroups: [""]\n  resources: ["pods"]\n  verbs: ["get", "list", "watch"]\n```\n\n**2. Network Policies** — restrict pod-to-pod traffic:\n```yaml\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: deny-all\nspec:\n  podSelector: {}\n  policyTypes: ["Ingress", "Egress"]\n```\n\n**3. Secrets management:**\n- Use `kubectl create secret` (base64 only — NOT encrypted at rest by default)\n- For production: **External Secrets Operator**, **HashiCorp Vault**, or **AWS Secrets Manager**\n\n**4. Pod Security:**\n- Set `runAsNonRoot: true`, `readOnlyRootFilesystem: true`\n- Drop all capabilities: `securityContext.capabilities.drop: ["ALL"]`\n- Use Pod Security Standards (restricted/baseline/privileged)\n\n**5. Image security:** Scan images with Trivy/Snyk, use signed images, pull from private registries only.',
              'networking': '**Kubernetes networking:**\n\n**Service types:**\n- **ClusterIP** — internal only (default)\n- **NodePort** — exposes on each node\'s IP at a static port\n- **LoadBalancer** — provisions external cloud load balancer\n- **ExternalName** — maps to a DNS name\n\n**Ingress** — HTTP/HTTPS routing:\n```yaml\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: my-ingress\nspec:\n  rules:\n  - host: app.example.com\n    http:\n      paths:\n      - path: /\n        pathType: Prefix\n        backend:\n          service:\n            name: my-app\n            port:\n              number: 80\n```\n\n**DNS:** Every service gets a DNS name: `<service>.<namespace>.svc.cluster.local`.\n\n**Network Policies** control which pods can communicate — by default, all pods can reach all pods.',
              'monitoring': '**Kubernetes monitoring:**\n\n**Stack:** Prometheus (metrics) + Grafana (dashboards) + Alertmanager (alerts).\n\n**Key metrics:**\n- **Node:** CPU/memory utilization, disk pressure, network I/O\n- **Pod:** restart count, OOMKilled events, request vs limit usage\n- **Cluster:** pending pods, failed scheduling, API server latency\n\n**Commands:**\n```bash\nkubectl top nodes          # node resource usage\nkubectl top pods           # pod resource usage\nkubectl describe pod <pod> # events + conditions\nkubectl logs <pod> -f      # stream logs\n```\n\n**Liveness vs Readiness probes:**\n- **Liveness** — restart container if unhealthy\n- **Readiness** — remove from service if not ready\n- **Startup** — delay other probes until app is initialized',
            },
            'docker': {
              'security': '**Docker security best practices:**\n\n1. **Don\'t run as root** — use `USER node` in Dockerfile\n2. **Use minimal base images** — `alpine` or `distroless`\n3. **Scan images** — `docker scout cves my-image` or Trivy/Snyk\n4. **Don\'t store secrets in images** — use `--secret` flag or env vars at runtime\n5. **Read-only filesystem** — `docker run --read-only`\n6. **Drop capabilities** — `docker run --cap-drop ALL --cap-add NET_BIND_SERVICE`\n7. **Use multi-stage builds** — don\'t ship build tools in production image\n8. **Pin image versions** — `node:20.11-alpine` not `node:latest`\n9. **Limit resources** — `docker run --memory=512m --cpus=1`\n10. **Use Docker Content Trust** — `export DOCKER_CONTENT_TRUST=1` for signed images',
              'networking': '**Docker networking:**\n\n**Network types:**\n- **bridge** (default) — containers on same host communicate\n- **host** — container shares host network stack\n- **none** — no networking\n- **overlay** — multi-host networking (Swarm/K8s)\n\n**Commands:**\n```bash\ndocker network create my-net\ndocker run --network my-net --name app1 my-image\ndocker run --network my-net --name app2 my-image\n# app1 can reach app2 by name: http://app2:3000\n```\n\n**Port mapping:** `-p 8080:3000` maps host:8080 → container:3000.\n**DNS:** Containers on the same user-defined network resolve each other by container name.',
            },
            'react': {
              'performance': '**React performance optimization:**\n\n1. **React.memo()** — skip re-renders when props haven\'t changed\n2. **useMemo()** — cache expensive computed values\n3. **useCallback()** — stable function references for child components\n4. **Code splitting** — `React.lazy(() => import("./HeavyComponent"))`\n5. **Virtualization** — `react-window` or `@tanstack/virtual` for long lists\n6. **Keys** — use stable unique IDs, never array index for dynamic lists\n7. **State colocation** — keep state close to where it\'s used (avoid lifting too high)\n8. **Profiler** — React DevTools Profiler to identify slow renders',
              'testing': '**React testing:**\n\n**Stack:** Vitest + React Testing Library + MSW (API mocking).\n\n```tsx\nimport { render, screen, fireEvent } from "@testing-library/react";\nimport { Counter } from "./Counter";\n\ntest("increments count", () => {\n  render(<Counter />);\n  fireEvent.click(screen.getByText("+1"));\n  expect(screen.getByText("Count: 1")).toBeInTheDocument();\n});\n```\n\n**Principles:**\n- Test behavior, not implementation\n- Query by role/label (accessible selectors), not test IDs\n- Mock external dependencies (API calls, timers), not internal state',
            },
            'typescript': {
              'generics': '**TypeScript generics:**\n\n```typescript\n// Basic generic function\nfunction identity<T>(value: T): T { return value; }\n\n// Generic with constraint\nfunction getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {\n  return obj[key];\n}\n\n// Generic interface\ninterface Repository<T> {\n  find(id: string): Promise<T | null>;\n  save(item: T): Promise<void>;\n}\n\n// Generic class\nclass Stack<T> {\n  private items: T[] = [];\n  push(item: T) { this.items.push(item); }\n  pop(): T | undefined { return this.items.pop(); }\n}\n```\n\n**Common patterns:** `Array<T>`, `Promise<T>`, `Record<K, V>`, `Map<K, V>`.',
            },
            'git': {
              'merge': '**Git merge strategies:**\n\n- **Fast-forward** (`git merge --ff-only`) — linear history, only works if no divergence\n- **Merge commit** (`git merge --no-ff`) — preserves branch history with a merge commit\n- **Squash** (`git merge --squash`) — combines all branch commits into one\n- **Rebase** (`git rebase main`) — replays commits on top of target branch (linear history)\n\n**When to use what:**\n- Feature branches → squash merge (clean main history)\n- Release branches → merge commit (preserve history)\n- Keeping up-to-date → rebase (avoid merge commits in feature branches)',
            },
            'microservice': {
              'communication': '**Microservice communication patterns:**\n\n**Synchronous:**\n- **REST** — simple, HTTP-based, JSON payloads\n- **gRPC** — binary protocol, typed contracts (Protobuf), ~10x faster than REST\n- **GraphQL** — flexible queries, single endpoint\n\n**Asynchronous:**\n- **Message queues** (RabbitMQ, SQS) — point-to-point, guaranteed delivery\n- **Event streaming** (Kafka, NATS) — pub/sub, event replay, high throughput\n- **Webhooks** — HTTP callbacks for external integrations\n\n**Best practice:** Use sync for real-time queries, async for commands and events. Prefer events between services to reduce coupling.',
              'pattern': '**Key microservice patterns:**\n\n- **API Gateway** — single entry point, handles routing, auth, rate limiting\n- **Circuit Breaker** — fail fast when downstream service is unhealthy\n- **Saga** — coordinated distributed transactions (choreography or orchestration)\n- **CQRS** — separate read/write models for different scaling needs\n- **Event Sourcing** — store events instead of current state, full audit trail\n- **Sidecar** — attach shared concerns (logging, proxy) as a separate container\n- **Strangler Fig** — incrementally replace monolith with microservices',
            },
            'ci/cd': {
              'testing': '**CI/CD testing strategies:**\n\n**Test pyramid:**\n1. **Unit tests** (fast, many) — business logic, pure functions\n2. **Integration tests** (medium) — API endpoints, database queries\n3. **E2E tests** (slow, few) — critical user journeys only\n\n**In the pipeline:**\n- Run lint + unit tests on every push (< 5 min)\n- Run integration tests on PR (< 15 min)\n- Run E2E tests on merge to main (< 30 min)\n- Use test parallelism and caching aggressively\n\n**Quality gates:** Block merge if coverage drops, tests fail, or lint errors exist.',
              'deployment': '**CI/CD deployment strategies:**\n\n- **Rolling** — gradually replace old instances (default in K8s)\n- **Blue-Green** — two identical environments, switch traffic instantly\n- **Canary** — route 5% of traffic to new version, watch metrics, then roll out\n- **Feature flags** — deploy code but control visibility per user/group\n\n**Rollback plan:**\n- Keep previous artifacts/images tagged\n- Automate rollback on health check failure\n- Blue-green gives instant rollback — just switch back',
            },
            'postgresql': {
              'performance': '**PostgreSQL performance tuning:**\n\n**1. Indexing:**\n- B-tree (default) — equality and range queries\n- GIN — JSONB, arrays, full-text search\n- GiST — geospatial (PostGIS)\n- BRIN — large, naturally ordered tables\n\n**2. Query analysis:**\n```sql\nEXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE email = \'a@b.com\';\n```\nLook for: Seq Scan (missing index), high buffer reads, nested loops on large tables.\n\n**3. Connection pooling:** Use PgBouncer or Supabase Pooler — PostgreSQL forks a process per connection.\n\n**4. Tuning:** Increase `shared_buffers` (25% of RAM), `work_mem` (for sorts), `effective_cache_size` (75% of RAM).',
              'security': '**PostgreSQL security:**\n\n- **Row-Level Security (RLS):**\n```sql\nALTER TABLE documents ENABLE ROW LEVEL SECURITY;\nCREATE POLICY user_docs ON documents FOR ALL USING (user_id = current_setting(\'app.user_id\')::int);\n```\n- **Roles & permissions:** Principle of least privilege — separate read/write/admin roles\n- **SSL/TLS:** Enforce `sslmode=require` for all connections\n- **pg_hba.conf:** Restrict which hosts/users can connect\n- **Audit logging:** Use `pgaudit` extension for compliance',
            },
            'graphql': {
              'schema': '**GraphQL schema design:**\n\n```graphql\ntype User {\n  id: ID!\n  name: String!\n  email: String!\n  posts: [Post!]!\n}\n\ntype Post {\n  id: ID!\n  title: String!\n  content: String!\n  author: User!\n  createdAt: DateTime!\n}\n\ntype Query {\n  user(id: ID!): User\n  posts(limit: Int = 10, offset: Int = 0): [Post!]!\n}\n\ntype Mutation {\n  createPost(title: String!, content: String!): Post!\n}\n```\n\n**Best practices:** Use non-nullable types (`!`) by default, paginate lists, design mutations around business operations (not CRUD).',
              'performance': '**GraphQL performance:**\n\n**N+1 problem:** Fetching a list of users, then each user\'s posts = N+1 queries.\n\n**Solution — DataLoader:**\n```typescript\nconst userLoader = new DataLoader(async (ids: string[]) => {\n  const users = await db.users.findMany({ where: { id: { in: ids } } });\n  return ids.map(id => users.find(u => u.id === id));\n});\n```\n\n**Other optimizations:**\n- **Query complexity limits** — prevent deeply nested queries\n- **Persisted queries** — whitelist allowed queries in production\n- **@defer / @stream** — incremental delivery for large responses\n- **Apollo Cache** — normalized client-side caching reduces re-fetches',
            },
            'redis': {
              'caching': '**Redis caching patterns:**\n\n**Cache-Aside (most common):**\n1. Check cache → if hit, return\n2. If miss, query database\n3. Store result in cache with TTL\n\n**Write-Through:** Write to cache + database simultaneously.\n**Write-Behind:** Write to cache, async batch-write to database.\n\n**TTL strategies:**\n- Short TTL (60s) for frequently changing data\n- Long TTL (1h+) for rarely changing data\n- `SETEX key 3600 value` or `SET key value EX 3600`\n\n**Cache invalidation:** The hardest problem — use TTL as safety net, invalidate on writes, or use pub/sub for real-time invalidation.',
              'scaling': '**Redis scaling:**\n\n**Replication:** Primary → replicas for read scaling.\n\n**Sentinel:** Automatic failover — promotes replica to primary if primary dies.\n\n**Cluster:** Data sharded across multiple nodes (16,384 hash slots). Use for datasets > single-node RAM.\n\n**Memory optimization:**\n- Use hashes for objects (more compact than individual keys)\n- Set `maxmemory-policy allkeys-lru` to auto-evict least-recently-used keys\n- Monitor with `INFO memory` and `MEMORY USAGE key`',
            },
            'mongodb': {
              'schema': '**MongoDB schema design:**\n\n**Embed vs reference:**\n- **Embed** when data is always accessed together (1:1, 1:few)\n- **Reference** when data is accessed independently or grows unboundedly (1:many, many:many)\n\n**Example — blog post with comments:**\n```javascript\n// Embedded (good for < 100 comments)\n{ title: "Hello", comments: [{ text: "Nice!", user: "alice" }] }\n\n// Referenced (good for many comments)\n{ title: "Hello", _id: "post1" }\n{ text: "Nice!", postId: "post1", user: "alice" }\n```\n\n**Validation:**\n```javascript\ndb.createCollection("users", {\n  validator: { $jsonSchema: { required: ["name", "email"] } }\n});\n```',
              'performance': '**MongoDB performance:**\n\n**Indexes:**\n- Single field: `db.users.createIndex({ email: 1 })`\n- Compound: `db.orders.createIndex({ userId: 1, createdAt: -1 })`\n- Text: `db.articles.createIndex({ title: "text", body: "text" })`\n\n**Query optimization:**\n- Use `.explain("executionStats")` to analyze queries\n- Covered queries (all fields in index) are fastest\n- Avoid `$regex` on non-indexed fields\n\n**Scaling:**\n- **Replica sets** — automatic failover + read scaling\n- **Sharding** — horizontal scaling for massive datasets\n- Choose shard key carefully (high cardinality, even distribution)',
            },
          };

          // Find matching main topic from previous answer
          for (const [mainTopic, subtopics] of Object.entries(subtopicMap)) {
            if (prev.includes(mainTopic)) {
              // Check if subtopic matches any key
              for (const [subKey, content] of Object.entries(subtopics)) {
                if (subtopic.includes(subKey) || subKey.includes(subtopic.replace(/\s+in\s+\w+$/i, '').trim())) {
                  return content;
                }
              }
            }
          }

          // Subtopic not in map — try knowledge search and CS fundamentals
          const csAnswer = deps.tryCSFundamentals(`how does ${subtopic} work`);
          if (csAnswer) return csAnswer;
          const csAnswer2 = deps.tryCSFundamentals(`what is ${subtopic}`);
          if (csAnswer2) return csAnswer2;
          const inferredMainTopic = lastAssistant?.content.match(/\*\*([^*]+)\*\*/)?.[1]?.replace(/[*:]/g, '').trim().toLowerCase() || '';
          const searchQuery = inferredMainTopic ? `${inferredMainTopic} ${subtopic}` : subtopic;
          const match = deps.cachedFindBestMatch(searchQuery);
          if (match && match.response.length > 50 && !KnowledgeStore.isJunkContent(match.response)) {
            return `**${subtopic.charAt(0).toUpperCase() + subtopic.slice(1)}:**\n\n${match.response}`;
          }
          // Try synthesis from knowledge store
          const retrieved = deps.cachedRetrieveRelevant(subtopic, 3);
          const relevant = retrieved.filter(r => r.score > 0.01 && !KnowledgeStore.isJunkContent(r.text) && r.text.length > 60);
          if (relevant.length > 0) {
            const sentences = relevant[0].text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20).slice(0, 4);
            if (sentences.length >= 2) {
              return `**${subtopic.charAt(0).toUpperCase() + subtopic.slice(1)}:**\n\n${sentences.join(' ')}`;
            }
          }
          // Offer to go deeper on the specific subtopic
          return `I haven't gone deep on **${subtopic}** yet${inferredMainTopic ? ` in the context of ${inferredMainTopic}` : ''}. Try asking:\n- "How does ${subtopic} work?"\n- "Explain ${subtopic} with an example"\n- "What are ${subtopic} best practices?"`;

        }
      }
    }

    // Write/say a sentence in Norwegian
    if (/(?:write|say|give|tell)\s+(?:to\s+)?(?:me\s+)?(?:a\s+)?(?:sentence|phrase|something|words?)\s+(?:in\s+)?(?:norwegian|norsk)/i.test(input)) {
      const sentences = [
        'Hei! Mitt navn er VeggaAI, og jeg er en lokal AI bygget fra bunnen av.',
        'Norge er et vakkert land med fjorder, fjell og midnattssol.',
        'Jeg lærer nye ting hver dag — jo mer du lærer meg, jo smartere blir jeg.',
        'Kunnskap er makt, og sammen kan vi bygge noe helt fantastisk.',
        'God morgen! Hva vil du at jeg skal hjelpe deg med i dag?',
      ];
      return sentences[Math.floor(deps._rng() * sentences.length)];
    }

    // Generic "write me a sentence" (English) — but NOT "give me something to build/try/learn"
    if (/(?:write|say|give|tell)\s+(?:me\s+)?(?:a\s+)?(?:sentence|phrase|something)\b/i.test(input)
        && !/\b(?:code|program|function|class|script|build|create|make|project|idea|try|learn|explore)\b/i.test(input)) {
      return 'The fastest path to understanding is through building — write code, break things, and learn from every failure.';
    }

    // "Give me something cool to build" / "what should I build" / project ideas
    if (/\b(?:give\s+me\s+(?:something|an?\s+idea|ideas?)|suggest\s+(?:something|a\s+project|projects?)|what\s+(?:should|can|could)\s+i\s+(?:build|make|create)|project\s+ideas?|something\s+(?:cool|fun|interesting)\s+to\s+(?:build|make|create|try))\b/i.test(input)) {
      const ideas = [
        '**Real-time chat app** — WebSocket server + React frontend. Learn: events, state sync, presence indicators.',
        '**Personal finance tracker** — categorize expenses, monthly charts, CSV import. Stack: Next.js + Prisma + PostgreSQL.',
        '**CLI tool** — build a productivity tool (todo, notes, time tracker) with Node.js + Commander. Publish to npm.',
        '**Multiplayer game** — tic-tac-toe or snake with Socket.io. Learn: game loops, state machines, latency.',
        '**API aggregator dashboard** — pull GitHub stats, weather, news into one view. Learn: REST, caching, rate limits.',
        '**Markdown blog engine** — static site generator with frontmatter, syntax highlighting, RSS. Deploy to Vercel.',
        '**Screenshot-to-code tool** — upload a design, get HTML/CSS. Learn: image processing, layout algorithms.',
      ];
      const pick = (arr: string[], n: number) => {
        const shuffled = [...arr].sort(() => deps._rng() - 0.5);
        return shuffled.slice(0, n);
      };
      return `Here are some project ideas:\n\n${pick(ideas, 4).map((idea, i) => `${i + 1}. ${idea}`).join('\n')}\n\nWant me to scaffold any of these?`;
    }

    // "What do you know about X?" / "what do you know of X?" / "what do you know on X?"
    // Topic is normalized through extractTopicFromQuery so prepositions and
    // residual framing ("tell me about of X", "what do you know regarding X")
    // are stripped before retrieval — otherwise TF-IDF treats "of" as a token
    // and ranks unrelated docs above the real topic.
    const aboutMatch = input.match(/^\s*what\s+do\s+you\s+know\b/i);
    if (aboutMatch) {
      const topic = extractTopicFromQuery(input);

      // Degenerate case: user asked "what do you know?" with no topic — the
      // framing strip leaves the original phrase, so ask for a subject instead
      // of polluting retrieval with the question itself.
      if (topic.length === 0 || /^what\s+do\s+you\s+know/i.test(topic) || topic.split(/\s+/).every(t => t.length < 2)) {
        return 'Ask me about a specific topic — for example, "what do you know about Docker?" or "what do you know about Postgres?"';
      }

      // Content tokens drive the TopicGuard — every retrieval result and
      // sentence we surface must concern at least one of them. Without this,
      // TF-IDF will happily return an unrelated doc whose top tokens are
      // simply the most frequent words in the corpus.
      const contentTokens = topicContentTokens(topic);

      // First: try direct pattern match (catches built-in entries like "react overview", "kubernetes overview")
      const directMatch = deps.cachedFindBestMatch(`${topic} overview`) || deps.cachedFindBestMatch(topic);
      if (directMatch
        && directMatch.response.length > 50
        && !KnowledgeStore.isJunkContent(directMatch.response)
        && textConcernsTopic(`${directMatch.pattern} ${directMatch.response}`, topic)) {
        return directMatch.response.length > 500 ? directMatch.response.slice(0, 500) + '...' : directMatch.response;
      }

      // Second: try concept lookup
      const concept = deps.knowledge.findConcept(topic);
      if (concept
        && !KnowledgeStore.isJunkContent(concept.definition)
        && concept.definition.length > 30
        && textConcernsTopic(`${concept.name} ${concept.definition}`, topic)) {
        return concept.definition;
      }

      // Third: TF-IDF retrieval. Apply the same retrieval-quality floor used by
      // chat RAG injection (KNOWLEDGE_RETRIEVAL_SCORE_MIN = 0.18) and require
      // the candidate doc to actually mention the topic. Anything below the
      // floor or off-topic falls through to web search instead of being
      // surfaced as authoritative.
      const retrieved = deps.cachedRetrieveRelevant(topic, 5);
      const clean = retrieved.filter(r =>
        !KnowledgeStore.isJunkContent(r.text)
        && r.score >= KNOWLEDGE_RETRIEVAL_SCORE_MIN
        && (contentTokens.length === 0 || textConcernsTopic(r.text, topic))
      );
      if (clean.length > 0) {
        // Sentence-level TopicGuard: only surface sentences that mention a
        // topic content token. If none qualify, fall through — better to ask
        // for more context than to return loosely-related prose.
        const best = clean[0];
        const sentences = best.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
        const relevant = sentences.filter(s => textConcernsTopic(s, topic));
        if (relevant.length === 0) return null;
        const output = relevant.slice(0, 5).join(' ');
        return output.length > 500 ? output.slice(0, 500) + '...' : output;
      }
      return null; // Fall through to web search
    }

    // Personal introductions: "my name is X [and ...]" / "I'm Vetle [and ...]"
    // Extract just the first name word (stop at "and", comma, or sentence boundary)
    // ALSO: nickname/intent prelude — "my nickname is ola and I am going to ask you to ..."
    // We capture the nickname AND acknowledge the upcoming question instead of stalling.
    const nicknameMatch = input.match(/\bmy\s+(?:nickname|nick|alias|handle|name)\s+is\s+([a-z][a-z'\-]{1,25})\b/i);
    const wantsToAsk = /\b(?:i\s+(?:am|'m|will|wanna|want\s+to)\s+(?:going\s+to\s+)?ask|going\s+to\s+ask|i\s+will\s+then\s+ask|then\s+i\s+(?:will|'ll)\s+ask)\b/i.test(input);
    if (nicknameMatch && wantsToAsk) {
      const nick = nicknameMatch[1].trim();
      const cap = nick.charAt(0).toUpperCase() + nick.slice(1);
      return `Got it, **${cap}** — noted. Go ahead and ask, I'll do my best to answer.`;
    }

    const nameIntroMatch = input.match(/^my\s+name\s+is\s+([a-z]+)/i)
      || input.match(/^i(?:'m| am)\s+([a-z]+)/i);
    if (nameIntroMatch) {
      const rawName = nameIntroMatch[1].trim();
      const name = rawName.toLowerCase();
      // Skip if input looks like a status/problem report (not a name intro)
      const looksLikeProblem = /\b(?:getting|having|seeing|facing|experiencing|encountering|running\s+into|dealing\s+with|overwhelmed|frustrated|anxious|stressed|exhausted|worried|panicking|struggling|debugging|blocked|stuck|confused|fuzzy|unclear|lost|unsure|not\s+sure|trying\s+to|can't|cannot|doesn't|don't|won't|error|issue|problem|bug|crash|fail|broken|missing|undefined|null|weird|strange)\b/i.test(input);
      // Must look like a name: not a common action/article/state word
      if (deps.isCredibleNameIntroduction(input, nameIntroMatch, rawName)
        && !looksLikeProblem && name.length >= 2 && name.length <= 25
        && !/^(?:a|an|the|not|also|just|very|so|too|yet|well|still|already|now|here|there|back|done|new|good|bad|ok|okay|sure|glad|happy|ready|able|from|to|for|with|at|by|about|into|over|after|before|between|through|during|against|without|along|across|around|upon|toward|towards|under|above|below|near|behind|beside|beyond|going|trying|looking|working|building|making|planning|developing|creating|using|getting|having|seeing|asking|thinking|wondering|feeling|saying|writing|reading|finding|following|checking|testing|starting|running|doing|waiting|hoping|wanting|needing|learning|fixing|adding|changing|moving|taking|putting|setting|calling|sending|loading|updating|showing|rendering|handling|connecting|deploying|installing|configuring|overwhelmed|confused|fuzzy|unclear|stuck|lost|unsure|excited|sorry|aware|able|unable|sure|certain|afraid|worried|frustrated|anxious|stressed|exhausted|panicking|struggling|debugging|blocked|happy|sad|tired|ready|new|old|here|there|back|done|gone|up|down|in|out|on|off)$/i.test(name)) {
        const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
        // Check if there's more context after the name (e.g. "...and I am building a todo app")
        const rest = input.replace(nameIntroMatch[0], '').trim().replace(/^[,\s]+/, '');
        // Filter out pure transitional phrases — they don't add context
        const isTransitional = /^(?:by\s+the\s+way|just\s+(?:so\s+you\s+know|wanted\s+to\s+say|fyi)|nice\s+to\s+meet\s+you|btw|anyway|so\s+yeah|yeah)[\s!.]*$/i.test(rest);
        if (rest && rest.length > 5 && !isTransitional) {
          return `Nice to meet you, **${capitalized}**! I can see you mentioned: "${rest}". What would you like to do?`;
        }
        return `Nice to meet you, **${capitalized}**! I'll remember your name for this conversation. What can I help you with?`;
      }
    }

    // User is teaching: "Python is a programming language" / "remember that X means Y"
    // Also handles longer teaching like "I want to teach you about X: ..."
    // MUST NOT match questions: skip if starts with question words, command words, or contains "?"
    // MUST NOT match comparisons: "X vs Y which is better" is a question, not a teaching
    // MUST NOT match greetings or directives mixed with questions like
    //   "hello i am vetle and i want to know who is king in norway, please tell me ..."
    //   That is a question wrapped in a greeting, not a fact to learn.
    const wordCount = input.trim().split(/\s+/).length;
    const teachGateBlocks = /^(?:hello|hi|hey|hei|yo|sup|greetings|good\s+(?:morning|afternoon|evening))\b/i.test(input)
      || /\b(?:please|kindly|could\s+you|can\s+you|would\s+you|will\s+you)\b/i.test(input)
      || /\b(?:tell|give|show|reply|respond|answer|explain|describe|list|find|search|look\s+up|teach\s+me|help\s+me|let\s+me\s+know|i\s+want\s+to\s+(?:know|learn|see|find|build|make|create))\b/i.test(input)
      || /^(?:name|pick|choose|select|suggest)\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|some|the|me)\b/i.test(input)
      || wordCount > 18;
    if (!teachGateBlocks && !/^(what|who|how|why|when|where|which|can|do|does|did|is\s+(it|there)|are\s+(you|there)|explain|describe|tell|show|list|compare|give|write|create|build|make|generate|set\s?up|implement)\b/i.test(input) && !input.includes('?') && !/\b(?:vs\.?|versus|compare|difference|which\s+(?:is|are|one))\b/i.test(input)) {
      // Short teaching: "X is Y"
      const teachMatch = input.match(/^(?:remember\s+that\s+)?([A-Za-z][A-Za-z0-9 _-]{2,50})\s+(?:is|means|equals)\s+(.{3,200})$/i);
      if (teachMatch) {
        const pattern = teachMatch[1].trim();
        const response = teachMatch[2].trim();
        // Don't treat personal introductions as facts to learn ("my name is X", "i am X")
        const isPersonalIntro = /^(?:my\s+name|i|my\s+(?:age|job|role|project)|our\s+project)$/i.test(pattern);
        // Don't treat exclusion semantics as teaching: "X that is NOT Y", "X is not Y" used
        // inside a request shape ("name a country that is not France") — the "response" half
        // begins with a negation marker that signals constraint, not factual definition.
        const isExclusionResponse = /^(?:not|no|never|none\s+of)\b/i.test(response);
        if (!isPersonalIntro
          && !isExclusionResponse
          && !/^(it|this|that|the|a|an|my|your|so|now|here|there|also|just)$/i.test(pattern)
          && !/\b(?:function|class|method|implement|algorithm|program|script|code|module|interface|struct|enum)\b/i.test(pattern)) {
          deps.knowledge.addEntry(pattern, response, 'user-taught', 'en');
          deps.knowledge.learn(`${pattern} is ${response}`, 'user-taught', 'en');
          deps.tokenizer.encode(`${pattern} ${response}`);
          return `Got it! I've learned that "${pattern}" is "${response}". I'll remember this.`;
        }
      }

      // Correction patterns: "Actually, X is Y" / "No, X is Y" / "That's wrong, X is Y" / "X should be Y"
      const correctionMatch = input.match(/^(?:actually|no|nope|wrong|that'?s\s+(?:wrong|incorrect|not\s+right)|correction)[,:\s]*(?:the\s+)?([A-Za-z][A-Za-z0-9 _-]{2,60})\s+(?:is|should\s+be|means|equals|=)\s+(.{3,200})$/i)
        || input.match(/^(?:the\s+)?(?:correct|right|actual)\s+(?:answer|response|info)\s+(?:is|for)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _-]{2,60})\s+(?:is|=)\s+(.{3,200})$/i)
        || input.match(/^([A-Za-z][A-Za-z0-9 _-]{2,60})\s+(?:should\s+be|is\s+actually|is\s+really)\s+(.{3,200})$/i);
      if (correctionMatch) {
        const pattern = correctionMatch[1].trim();
        const response = correctionMatch[2].trim();
        if (!/^(it|this|that|the|a|an|my|your|so|now|here|there|also|just)$/i.test(pattern)
          && !/\b(?:function|class|method|implement|algorithm|program|script|code|module|interface|struct|enum)\b/i.test(pattern)) {
          deps.knowledge.addEntry(pattern, response, 'user-taught', 'en');
          deps.knowledge.learn(`${pattern} is ${response}`, 'user-taught', 'en');
          deps.tokenizer.encode(`${pattern} ${response}`);
          return `Thanks for the correction! I've updated my knowledge: "${pattern}" → "${response}". I'll get it right next time.`;
        }
      }

      // Long teaching: "I want to teach you..." / "Let me teach you..." / "Here is something important..."
      const longTeachMatch = input.match(/^(?:i\s+want\s+to\s+teach\s+you|let\s+me\s+teach\s+you|here\s+is\s+(?:something|a\s+(?:key|important|profound))|learn\s+this|remember\s+this|the\s+concept\s+(?:is|of))\b[:\s]*(.{10,})/i);
      if (longTeachMatch) {
        const content = longTeachMatch[1].trim();
        // Extract key concepts from the teaching
        const sentences = content.split(/(?<=[.!])\s+/).filter(s => s.length > 10);
        const keyPhrases: string[] = [];

        for (const sentence of sentences.slice(0, 5)) {
          // Extract "X means Y" / "X is Y" patterns from the teaching
          const defMatch = sentence.match(/[""]?([A-Za-z][A-Za-z ]{2,40})[""]?\s*[-–—]?\s*(?:it\s+)?(?:means?|is|refers\s+to)\s+(.{5,})/i);
          if (defMatch) {
            deps.knowledge.addEntry(defMatch[1].trim(), defMatch[2].trim(), 'user-taught', 'en');
            keyPhrases.push(defMatch[1].trim());
          }
        }

        // Learn the full text as knowledge
        deps.knowledge.learn(content, 'user-taught', 'en');
        deps.tokenizer.encode(content);

        if (keyPhrases.length > 0) {
          return `Thank you for teaching me! I've learned about: ${keyPhrases.join(', ')}. I've absorbed ${sentences.length} concepts from what you shared. Ask me about them anytime!`;
        }
        return `Thank you for teaching me! I've absorbed this knowledge (${sentences.length} key points). I'll do my best to apply what you've taught me. Ask me about it to see what I retained!`;
      }
    }

    // "What am I building?" / "What are we working on?" — context recall from current conversation
    if (/what\s+(?:am\s+i|are\s+we)\s+(?:building|working\s+on|making|creating|doing)/i.test(input)
      || /what\s+(?:is\s+(?:my|our)|are\s+(?:my|our))\s+(?:project|app|application)/i.test(input)) {
      const userMsgs = history.filter(m => m.role === 'user');
      const assistantMsgs = history.filter(m => m.role === 'assistant');
      // Look for mentions of building/project in earlier user messages
      const buildMsgs = userMsgs.filter(m => /build|make|create|develop|app|project|working\s+on/i.test(m.content));
      if (buildMsgs.length > 0) {
        const described = buildMsgs[0].content.slice(0, 200);
        return `Based on our conversation, you're building: **"${described}"**\n\nWant to continue where we left off, or take it in a new direction?`;
      }
      // Check if the assistant has produced code
      const hasCode = assistantMsgs.some(m => m.content.includes('```'));
      if (hasCode) {
        return `We've been working on a project together in this conversation. I've already generated some code for you — want me to continue building on it, or try something different?`;
      }
      return `I can only see what's happened in this conversation. You haven't described a specific project yet — what would you like to build?`;
    }

    // "What is my name?" — check conversation context first, not knowledge store
    if (/what\s+(?:is|was)\s+my\s+name[\s?!]*$/i.test(input)
      || /do\s+you\s+(?:know|remember)\s+my\s+name[\s?!]*$/i.test(input)) {
      const userMsgs = history.filter(m => m.role === 'user');
      // Search earlier messages for name introduction
      const nameMsg = userMsgs.find(m => /my\s+name\s+is\s+(\w+)/i.test(m.content) || /i(?:'m| am)\s+(\w+)/i.test(m.content));
      if (nameMsg) {
        const nameMatch = nameMsg.content.match(/my\s+name\s+is\s+(\w+)/i) || nameMsg.content.match(/i(?:'m| am)\s+(\w+)/i);
        if (nameMatch) return `Your name is **${nameMatch[1]}** — you mentioned it earlier in our conversation.`;
      }
      return `You haven't told me your name yet in this conversation. What's your name?`;
    }

    // Recall previous messages in this conversation
    if (/what\s+(was|did)\s+(my|i)\s+(first|last|previous)/i.test(input)
      || /what\s+did\s+i\s+(say|ask)/i.test(input)
      || /(?:can\s+you\s+)?(?:see|read|recall|remember)\s+(?:my|the)\s+(?:first|last|previous)\s+message/i.test(input)
      || /what\s+was\s+my\s+(?:first|last)\s+message/i.test(input)
      || /what\s+(?:have\s+i|did\s+i)\s+(?:said|asked|typed|written|sent)/i.test(input)
      || /(?:can\s+you\s+see|do\s+you\s+(?:see|know|remember))\s+(?:my|what)\s+(?:first|previous|last|earlier)\s+message/i.test(input)
      || /(?:can\s+you\s+see|do\s+you\s+(?:see|know|remember))\s+(?:our|this|the)\s+(?:conversation|chat)\s+history/i.test(input)
      || /(?:first|1st|second|2nd|third|3rd|fourth|4th)\s+(?:message|thing)\s+i\s+(?:sent|wrote|said|asked)/i.test(input)
      || /message\s+i\s+(?:sent|wrote|said|typed)\s+(?:you\s+)?(?:in\s+this|to\s+you)/i.test(input)) {
      const userMsgs = history.filter((m) => m.role === 'user');
      if (userMsgs.length > 1) {
        const first = userMsgs[0].content;
        const prev = userMsgs[userMsgs.length - 2]?.content;

        // Ordinal lookup: "first", "second", "third" etc.
        const ordinalMap: Record<string, number> = {
          first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2,
          fourth: 3, '4th': 3, fifth: 4, '5th': 4,
        };
        const allOrdinalMatches = [...input.matchAll(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b/gi)];
        if (allOrdinalMatches.length > 0) {
          const found: string[] = [];
          for (const m of allOrdinalMatches) {
            const idx = ordinalMap[m[1].toLowerCase()];
            if (idx !== undefined && userMsgs[idx]) {
              found.push(`Your **${m[1]}** message: "${userMsgs[idx].content}"`);
            }
          }
          if (found.length > 0) return found.join('\n\n');
          return `You've only sent ${userMsgs.length} message${userMsgs.length === 1 ? '' : 's'} so far in this conversation.`;
        }

        if (/first/i.test(input)) {
          return `Your first message in this conversation was: "${first}"`;
        }
        if (/last|previous|earlier/i.test(input)) {
          if (prev) {
            return `Your previous message was: "${prev}"`;
          }
        }
        // Generic "can you see my messages" / "do you remember"
        if (/(?:see|remember|recall|know)/i.test(input)) {
          return `Yes, I can see our conversation! Your first message was: "${first}". We've exchanged ${userMsgs.length} messages so far in this chat.`;
        }
        if (prev) {
          return `Your previous message was: "${prev}"`;
        }
      }
      // Even with 1 message, acknowledge we CAN see it
      if (userMsgs.length === 1) {
        return `I can see our conversation, but this is your first message — there's nothing to look back on yet!`;
      }
      return "I can see our conversation history, but there aren't enough messages yet to look back on.";
    }

    // Help / what can I do
    if (/^(help|what\s+can\s+(i|you)\s+do|how\s+do\s+(i|you)\s+work)/i.test(input)) {
      return `I'm VeggaAI — I learn from what you teach me and answer questions about it.\n\n**The basics:**\n- **Ask me anything** — "What is Docker?", "How do React hooks work?", "Compare PostgreSQL and MongoDB"\n- **Teach me** — feed me web pages, YouTube transcripts, or GitHub repos via the Chrome extension\n- **Check what I know** — "what do you know about [topic]?"\n- **Find my gaps** — "what do you need to learn?"\n\nThe more you teach me, the better I get. What would you like to start with?`;
    }

    // "What do you need to learn?" / "What should I teach you?"
    if (/what\s+(do\s+you\s+need|should\s+i\s+teach|are\s+your\s+gaps|don'?t\s+you\s+know|topics?\s+do\s+you\s+need)/i.test(input)) {
      return deps.buildKnowledgeGapReport();
    }

    // --- Context-aware follow-ups that use conversation history ---
    if (conversationTurns.length >= 2) {
      // Find the last MEANINGFUL assistant message (skip short reactions like "Glad to hear it!")
      const assistantMsgs = [...history].filter(m => m.role === 'assistant');
      const lastAssistant = assistantMsgs.reverse().find(m => m.content.length > 80) || assistantMsgs[0];
      const prevTopic = lastAssistant?.content.match(/\*\*([^*]+)\*\*/)?.[1]?.replace(/[*:]/g, '').trim().toLowerCase() || '';
      const prevContent = lastAssistant?.content || '';

      // "why?" / "but why?" — orphan follow-up referencing previous topic
      if (/^(?:but\s+)?why\??[\s!]*$/i.test(input) && prevTopic) {
        // Search knowledge for "why" + previous topic
        const whyQuery = `why ${prevTopic}`;
        const match = deps.cachedFindBestMatch(whyQuery);
        if (match && match.response.length > 50 && !KnowledgeStore.isJunkContent(match.response)) {
          return match.response.length > 800 ? match.response.slice(0, 800) + '...' : match.response;
        }
        // Fallback — give a contextual "why" answer based on what they were talking about
        return `For ${prevTopic}, "why" usually comes down to three things: what pain point it solves, what breaks if you don't use it, and what the alternatives are. If you can narrow it — "why ${prevTopic} vs X" or "why is ${prevTopic} designed this way" — I can give you a direct answer.`;
      }

      // "tell me more" / "go on" / "continue" — synthesize a deeper continuation from last response
      if (/^(?:tell\s+me\s+more|more\s+(?:details?|info(?:rmation)?)|go\s+on|continue|keep\s+going|and\s*\??)[\s!.]*$/i.test(input)) {
        if (prevContent.length > 80) {
          // Extract the topic and look for deeper content
          const searchTopic = prevTopic || prevContent.replace(/\*\*/g, '').split(/\s+/).filter(w => w.length > 4).slice(0, 3).join(' ');
          // Try knowledge retrieval for extended content
          const deeper = deps.cachedRetrieveRelevant(searchTopic + ' advanced details', 2);
          const deeperPieces = deeper.filter(d => d.score > 0.005 && !KnowledgeStore.isJunkContent(d.text) && d.text.length > 80);
          if (deeperPieces.length > 0) {
            const piece = deeperPieces[0].text;
            const sentences = piece.split(/(?<=[.!?])\s+/).filter(s => s.length > 20).slice(0, 5);
            if (sentences.length >= 2) {
              const suffix = prevTopic ? ` Ask about how ${prevTopic} handles a specific case if you want to go further.` : '';
              return `${sentences.join(' ')}${suffix}`;
            }
          }
          // Synthesize from the previous answer — extract sections that weren't fully explored
          const prevSections = prevContent.split(/\n\n+/).filter(s => s.length > 40);
          if (prevSections.length > 2) {
            // Return the section that wasn't in the first part
            const continuation = prevSections.slice(Math.floor(prevSections.length / 2)).join('\n\n');
            if (continuation.length > 100) {
              return `${continuation.slice(0, 600)}${continuation.length > 600 ? '\n\n...' : ''}`;
            }
          }
          // Final fallback — offer concrete next directions
          const t = prevTopic || 'this';
          return `A few useful directions from here: why ${t} works the way it does, a concrete ${t} example, common pitfalls and best practices, or how ${t} compares to the alternatives. Pick one and I'll go deeper.`;
        }
        return `What topic would you like me to continue with? Tell me what you're interested in and I'll go deeper.`;
      }

      // "tell me more about [specific subtopic]" when we have context
      const tellMoreMatch = input.match(/(?:tell\s+(?:me\s+)?more\s+about|what\s+(?:are|is)\s+(?:the\s+)?)\s+(.+?)[\s?.!]*$/i);
      if (tellMoreMatch && prevContent.length > 50) {
        const subtopic = tellMoreMatch[1].trim().toLowerCase();
        const subtopicBase = subtopic.replace(/s$/, ''); // strip trailing 's' for matching
        const prevLower = prevContent.toLowerCase();
        // If the subtopic (or its base form) was mentioned in the previous answer, do a targeted search
        if (prevLower.includes(subtopic) || prevLower.includes(subtopicBase) || prevTopic.includes(subtopicBase)) {
          const searchQuery = prevTopic ? `${prevTopic} ${subtopic}` : subtopic;
          const match = deps.cachedFindBestMatch(searchQuery);
          if (match && match.response.length > 50 && !KnowledgeStore.isJunkContent(match.response)) {
            return match.response.length > 800 ? match.response.slice(0, 800) + '...' : match.response;
          }
          // Try direct subtopic search
          const directMatch = deps.cachedFindBestMatch(subtopic);
          if (directMatch && directMatch.response.length > 50 && !KnowledgeStore.isJunkContent(directMatch.response)) {
            return directMatch.response;
          }
          // Use the subtopic map from the "what about" handler
          // If no knowledge found, provide a contextual response based on the previous explanation
          if (prevTopic) {
            // Extract sentences that mention the subtopic from the previous response
            const prevSentences = prevContent.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
            const relevantSentences = prevSentences.filter(s => {
              const sl = s.toLowerCase();
              return sl.includes(subtopic) || sl.includes(subtopicBase);
            });
            if (relevantSentences.length > 0) {
              return `${relevantSentences.join(' ')} If you want more on ${subtopic} specifically in the context of ${prevTopic}, ask directly and I'll go deeper.`;
            }
            return null; // Fall through to web search for subtopic
          }
          // Fall through to whatAbout handler which has detailed maps
        }
      }

      // "what else?" / "what else should I know?" / "anything else?"
      if (/^(?:what\s+else|anything\s+else|what\s+more|is\s+there\s+more)(?:\s+(?:should\s+I\s+know|can\s+you\s+tell\s+me|is\s+there|about\s+(?:it|this|that)))?[\s?!.]*$/i.test(input) && prevTopic) {
        // Search knowledge for related content the previous answer didn't cover
        const match = deps.cachedFindBestMatch(`${prevTopic} advanced`);
        if (match && match.response.length > 50 && !KnowledgeStore.isJunkContent(match.response)) {
          return match.response.length > 800 ? match.response.slice(0, 800) + '...' : match.response;
        }
        return `The main points on ${prevTopic} are covered. Good directions from here: a specific feature ("how does X work"), best practices, a comparison to an alternative, or a concrete example.`;
      }

      // "how do I use/deploy/install this?" — contextual "this" referencing previous topic
      if (/^how\s+(?:do|can|should)\s+i\s+(?:use|deploy|install|set\s*up|implement|run|start|test)\s+(?:this|that|it)[\s?!.]*$/i.test(input) && prevTopic) {
        const action = input.match(/(?:use|deploy|install|set\s*up|implement|run|start|test)/i)?.[0]?.toLowerCase() || 'use';

        // Deployment map — give concrete deployment instructions for common project types
        if (action === 'deploy') {
          const deployMap: Record<string, string> = {
            'react': '**Deploy your React app:**\n\n**Option 1 — Vercel (easiest):**\n```bash\nnpm i -g vercel\nvercel\n```\nDone. Vercel detects React automatically, builds & deploys.\n\n**Option 2 — Netlify:**\n```bash\nnpm run build\n# Drag the build/ folder to netlify.com, or:\nnpx netlify-cli deploy --prod --dir=build\n```\n\n**Option 3 — GitHub Pages:**\n```bash\nnpm install gh-pages --save-dev\n# Add to package.json: "homepage": "https://yourusername.github.io/your-repo"\n# Add scripts: "predeploy": "npm run build", "deploy": "gh-pages -d build"\nnpm run deploy\n```\n\n**Option 4 — Docker:**\n```dockerfile\nFROM node:20-alpine AS build\nWORKDIR /app\nCOPY package*.json .\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/build /usr/share/nginx/html\n```\n```bash\ndocker build -t my-react-app .\ndocker run -p 80:80 my-react-app\n```',
            'next': '**Deploy your Next.js app:**\n\n**Vercel (official host, zero-config):**\n```bash\nnpm i -g vercel\nvercel\n```\nVercel handles SSR, ISR, edge functions, and preview deploys automatically.\n\n**Self-hosted (Docker):**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json .\nRUN npm ci\nCOPY . .\nRUN npm run build\nCMD ["npm", "start"]\n```\n```bash\ndocker build -t my-next-app . && docker run -p 3000:3000 my-next-app\n```\n\n**Railway/Render:** Push to GitHub, connect repo, auto-deploys on push.',
            'node': '**Deploy your Node.js app:**\n\n**Railway (easiest):**\n1. Push to GitHub\n2. Connect at railway.app → New Project → Deploy from GitHub\n3. Railway auto-detects Node.js, sets PORT\n\n**Render:**\n```\nrender.com → New Web Service → Connect GitHub → Auto-deploy\n```\n\n**Docker (any cloud):**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json .\nRUN npm ci --production\nCOPY . .\nCMD ["node", "index.js"]\n```\n```bash\ndocker build -t my-app . && docker run -p 3000:3000 my-app\n```\n\n**VPS (DigitalOcean/AWS EC2):**\n```bash\nssh user@server\ngit clone <repo> && cd <repo>\nnpm ci --production\nPORT=3000 pm2 start index.js --name my-app\n```',
            'express': '**Deploy your Express app:**\n\n**Railway:** Push to GitHub → railway.app → auto-deploy. Set `PORT` env var.\n\n**Docker:**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json .\nRUN npm ci --production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]\n```\n\n**PM2 (production process manager):**\n```bash\nnpm i -g pm2\npm2 start index.js --name my-api -i max\npm2 save && pm2 startup\n```',
            'html': '**Deploy your HTML/CSS site:**\n\n**Netlify (drag & drop):**\n1. Go to app.netlify.com\n2. Drag your project folder onto the page\n3. Live in seconds.\n\n**GitHub Pages (free):**\n1. Push to GitHub\n2. Settings → Pages → Branch: main, folder: / (root)\n3. Your site is at `https://username.github.io/repo-name`\n\n**Vercel:**\n```bash\nnpx vercel\n```',
            'landing': '**Deploy your landing page:**\n\n**Netlify (recommended for static sites):**\n```bash\n# Just drag your folder to netlify.com, or:\nnpx netlify-cli deploy --prod --dir=.\n```\nFree SSL, CDN, custom domain support.\n\n**Vercel:**\n```bash\nnpx vercel\n```\n\n**GitHub Pages:** Push to GitHub → Settings → Pages → Enable.',
            'python': '**Deploy your Python app:**\n\n**Railway:**\nPush to GitHub → railway.app → auto-detects Python + requirements.txt.\n\n**Render:**\n```\nrender.com → New Web Service → Python → Auto-deploy\n```\n\n**Docker:**\n```dockerfile\nFROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nCMD ["python", "app.py"]\n```\n\n**Heroku:**\n```bash\nheroku create\ngit push heroku main\n```',
            'typescript': '**Deploy your TypeScript app:**\n\n```bash\nnpm run build  # Compile TS → JS\n```\n\n**Then deploy the compiled JS:**\n- **Railway/Render:** Push to GitHub, set build command to `npm run build`, start command to `node dist/index.js`\n- **Docker:** Build in multi-stage:\n```dockerfile\nFROM node:20-alpine AS build\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\n\nFROM node:20-alpine\nWORKDIR /app\nCOPY --from=build /app/dist ./dist\nCOPY --from=build /app/package*.json .\nRUN npm ci --production\nCMD ["node", "dist/index.js"]\n```',
            'docker': '**Deploy your Docker container:**\n\n**To a cloud:**\n```bash\n# Build & push to registry\ndocker build -t myregistry/myapp:latest .\ndocker push myregistry/myapp:latest\n\n# On server:\ndocker pull myregistry/myapp:latest\ndocker run -d -p 80:3000 myregistry/myapp:latest\n```\n\n**Docker Compose (multi-container):**\n```bash\ndocker-compose -f docker-compose.prod.yml up -d\n```\n\n**Cloud platforms:** AWS ECS, Google Cloud Run, Azure Container Instances, DigitalOcean App Platform — all accept Docker images directly.',
            'kubernetes': '**Deploy to Kubernetes:**\n\n```yaml\n# deployment.yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: my-app\n  template:\n    metadata:\n      labels:\n        app: my-app\n    spec:\n      containers:\n      - name: my-app\n        image: myregistry/myapp:latest\n        ports:\n        - containerPort: 3000\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: my-app-svc\nspec:\n  type: LoadBalancer\n  ports:\n  - port: 80\n    targetPort: 3000\n  selector:\n    app: my-app\n```\n```bash\nkubectl apply -f deployment.yaml\nkubectl get pods\n```',
          };

          for (const [key, instructions] of Object.entries(deployMap)) {
            if (prevTopic.includes(key) || prevContent.toLowerCase().includes(key)) {
              return instructions;
            }
          }
          // Fallback — general deploy guidance  
          return `**Deploy your ${prevTopic} project:**\n\n**Quickest options:**\n1. **Vercel** — \`npx vercel\` (auto-detects framework)\n2. **Netlify** — drag folder to netlify.com\n3. **Railway** — push to GitHub → railway.app\n\n**For full control:**\n- Dockerize with a Dockerfile\n- Deploy to any cloud (AWS, DigitalOcean, etc.)\n\nWant step-by-step instructions for a specific platform?`;
        }

        const match = deps.cachedFindBestMatch(`how to ${action} ${prevTopic}`);
        if (match && match.response.length > 50 && !KnowledgeStore.isJunkContent(match.response)) {
          return match.response;
        }
        return null; // Let it fall through to other handlers with topic context
      }
    }

    // --- Project iteration follow-ups ---
    // "now add dark mode", "change the color to blue", "convert it to Python", "add auth", etc.
    // Also: "same design but about photography", "same but different theme", "same layout but for X"
    if (conversationTurns.length >= 2) {
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
      const hasCodeBlock = lastAssistant && /```[\s\S]+```/.test(lastAssistant.content);

      if (hasCodeBlock) {
        // "same but X" / "same design but Y" / "same layout but Z" patterns
        const sameButMatch = input.match(/^(?:the\s+)?same\s+(?:(?:design|layout|style|look|UI|thing|app|project|page|site)\s+)?but\s+(?:(?:make|with|for|about)\s+)?(?:it\s+)?(?:about\s+|for\s+|with\s+)?(.+)/i);
        if (sameButMatch) {
          const change = sameButMatch[1].trim();
          const langMatch = lastAssistant.content.match(/```(\w+)/);
          const lang = langMatch ? langMatch[1] : 'html';
          return `I'll keep the same design but adjust it for **${change}**:\n\n` +
            deps.generateIterationCode('make', change, lang, lastAssistant.content);
        }

        // "different theme/subject/topic" patterns
        const differentMatch = input.match(/(?:different|new|another)\s+(theme|color.?scheme|palette|subject|topic|style|look|vibe)\b.*?(?:,?\s*(?:more\s+)?(.+))?$/i);
        if (differentMatch) {
          const aspect = differentMatch[1].toLowerCase();
          const detail = (differentMatch[2] || '').trim();
          const langMatch = lastAssistant.content.match(/```(\w+)/);
          const lang = langMatch ? langMatch[1] : 'html';
          const desc = detail ? `${aspect}: ${detail}` : aspect;
          return `I'll restyle with a **${desc}**:\n\n` +
            deps.generateIterationCode('change', `the ${desc}`, lang, lastAssistant.content);
        }

          const iterationMatch = input.match(/^(?:now\s+)?(?:can\s+you\s+)?(?:please\s+)?(add|change|modify|update|make|convert|port|switch|remove|delete|include|insert|replace|refactor|fix|style|use)(?:\s+(it|this|that))?\s+(.+)/i);
        if (iterationMatch) {
          const verb = iterationMatch[1].toLowerCase();
            const explicitReference = Boolean(iterationMatch[2]);
            if (verb === 'make' && !explicitReference) {
              return null;
            }
            const change = iterationMatch[3].trim();
          // Extract the language from the last code block
          const langMatch = lastAssistant.content.match(/```(\w+)/);
          const lang = langMatch ? langMatch[1] : 'unknown';
          // Extract the first ~100 chars of the code for context
          const codeMatch = lastAssistant.content.match(/```\w*\n([\s\S]*?)```/);
          const codeSnippet = codeMatch ? codeMatch[1].slice(0, 200) : '';

          return `I can see the ${lang} code I gave you. Here's how to **${verb} ${change}**:\n\n` +
            `Looking at the code that starts with:\n\`\`\`${lang}\n${codeSnippet.trim().split('\n').slice(0, 5).join('\n')}\n...\n\`\`\`\n\n` +
            deps.generateIterationCode(verb, change, lang, lastAssistant.content);
        }

        // "port to X" / "rewrite in X"
        const portMatch = input.match(/(?:port|rewrite|convert|translate)(?:\s+(?:it|this|that))?\s+(?:to|in|into|using)\s+(\w+)/i);
        if (portMatch) {
          const targetLang = portMatch[1].toLowerCase();
          return `I'll convert the code to **${targetLang}**! To regenerate it properly, tell me:\n\n` +
            `"Build me a [project type] in ${targetLang}"\n\n` +
            `For example: "Build me a REST API in ${targetLang}" or "Create a calculator in ${targetLang}". I'll generate complete, working ${targetLang} code.`;
        }
      }
    }

    // ── Personal context statements — "I am from Norway", "I'm a developer", "I work in fintech" ──
    const personalContextMatch = input.match(/^i(?:'m| am)\s+(?:from\s+(\w[\w\s]*?)(?:\s+and\b|\s*[,.]|$)|a\s+(\w[\w\s]*?)(?:\s+and\b|\s*[,.]|$))/i)
      || input.match(/^i\s+(?:work|live|reside)\s+(?:in|at|for)\s+(\w[\w\s]*?)(?:\s+and\b|\s*[,.]|$)/i);
    if (personalContextMatch) {
      const detail = (personalContextMatch[1] || personalContextMatch[2] || '').trim();
      // Check if there's more context after the initial statement
      const fullInput = input.toLowerCase();
      const hasMoreContext = /\band\s+(?:i\s+)?(?:have\s+been|am|was|work|want|need|like|love)/i.test(fullInput);
      const mentionsTech = /\b(?:web|software|frontend|backend|full[\s-]?stack|mobile|data|machine\s+learning|ai|dev(?:elop)?|programming|coding|engineer|design)/i.test(fullInput);
      const soundsLikeProjectRequest = /\b(?:can\s+you|could\s+you|help\s+me|make|build|create|design|develop)\b/i.test(fullInput)
        && /\b(?:website|site|app|application|project|portfolio|gallery|landing\s*page|homepage)\b/i.test(fullInput);

      if (soundsLikeProjectRequest) {
        return null;
      }

      if (hasMoreContext && mentionsTech) {
        // "I am from Norway and I have been working on web development"
        return `Sounds like you have a solid background. What are you working on right now, or what would you like to build? I can help with code, architecture, debugging, or just exploring ideas.`;
      }
      if (hasMoreContext) {
        return `What can I help you with today? I'm good at coding, explaining tech topics, building projects, and problem-solving.`;
      }
      if (detail) {
        return `What would you like to work on? I can help with coding, tech questions, building projects, and more.`;
      }
    }

    // ── Weather questions — we can't check weather but should say so clearly ──
    if (/\b(?:weather|temperature|forecast|rain(?:ing)?|snow(?:ing)?|sunny|cloudy|humid(?:ity)?)\b/i.test(input)
      && /\b(?:today|tonight|tomorrow|right\s+now|outside|currently|this\s+week|this\s+weekend)\b/i.test(input)) {
      return "I can't check the weather — I don't have access to real-time weather data or location services. Try checking a weather app or website like weather.com, or ask a voice assistant.\n\nI'm great at coding, tech questions, and building projects though — what can I help you with?";
    }

    // ── Casual personal statements — "I had a great day", "I'm tired", "I'm bored of X" ──
    if (/^(?:i\s+(?:had|have|am\s+having)\s+(?:a\s+)?(?:great|good|nice|bad|terrible|awful|rough|long|busy|productive|lazy|chill|fun)\s+(?:day|night|morning|evening|weekend|week))/i.test(input)) {
      const sentiment = /\b(?:great|good|nice|productive|fun|chill)\b/i.test(input) ? 'positive' : 'negative';
      if (sentiment === 'positive') {
        return "That's great to hear! Ready to cap it off with some coding or learning? I'm here if you want to build something, explore a topic, or just chat tech.";
      }
      return "Sorry to hear that. I'm here if you want to take your mind off it — we could build something cool, explore a topic, or work through a problem together.";
    }

    // ── "X vs Y" comparison questions should fall through to domain handlers, not get caught here ──
    if (/\b(?:vs\.?|versus)\b/i.test(input) && /\b(?:which|better|compare|difference|prefer)\b/i.test(input)) {
      return null; // Let comparison handlers or web search handle it
    }

    return null;
}
