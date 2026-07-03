/**
 * followup-rewrite — pure answer/knowledge builders extracted from VaiEngine (vai-engine.ts).
 *
 * These were private methods with ZERO this/super coupling. Moved verbatim (no dedent:
 * leading whitespace inside template literals is significant). VaiEngine delegates to
 * them via thin wrappers, so all call sites are unchanged. Behavior-preserving;
 * proven by golden snapshot + the full core test suite.
 */
/* eslint-disable */

import type { Message } from './adapter.js';

export function rewriteFollowupQuery(input: string, history: readonly Message[]): string | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed.length > 120) return null;

    // ---- Scope correction: "actually i meant the whole country, not the city"
    // → re-ask the prior question about the country instead of the city.
    if (/\b(?:i\s+(?:mean|meant)|talking\s+about|asking\s+about|the\s+whole)\b/i.test(trimmed)
        && /\b(?:whole\s+)?(?:country|nation)\b/i.test(trimmed)
        && /\bnot\s+(?:the\s+)?(?:city|town|capital)\b/i.test(trimmed)) {
      const COUNTRY_OF = /\b(?:capital|king|queen|currency|population|people|president|prime\s+minister)\s+(?:city\s+)?of\s+([a-z][a-z\s]{1,30}?)(?:[?.!,]|$)/i;
      let country: string | null = null;
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || typeof m.content !== 'string') continue;
        const cm = m.content.match(COUNTRY_OF);
        if (cm) { country = cm[1].trim(); break; }
      }
      const users = history.filter((m) => m.role === 'user' && typeof m.content === 'string');
      let priorQ: string | null = null;
      for (let i = users.length - 2; i >= 0; i -= 1) {
        const c = users[i].content.trim();
        if (/^(?:how|what|which|when|where|why|who|is|are|does|do|did|can)\b/i.test(c)) { priorQ = c; break; }
      }
      if (country && priorQ) {
        const base = priorQ
          .replace(/\b(?:there|here)\b/gi, '')
          .replace(/\bin\s+[A-Z][a-z]+\b/g, '')
          .replace(/\s+/g, ' ').replace(/[?.!]+$/g, '').trim();
        const C = country.charAt(0).toUpperCase() + country.slice(1);
        return `${base} in ${C}?`;
      }
    }

    // ---- Currency-symbol follow-up: "And its currency symbol, only the
    // symbol character." / "And the currency symbol of his country?" /
    // "You missed the symbol. Just the symbol character please." Resolve to
    // "Only the currency symbol of <country>." using the most recent
    // country mentioned in prior user turns (capital-of / king-of / etc.).
    if (/\bcurrency\s+symbol\b/i.test(trimmed) && /^(?:and\b|you\s+missed|just\s+the\s+symbol|give\s+me\s+the\s+symbol)/i.test(trimmed)) {
      const COUNTRY_RX = /\b(?:capital|king|queen|monarch|currency|symbol|code|president|chancellor)\s+(?:city\s+)?of\s+([a-z][a-z\s]{1,30}?)(?:[?.!,]|$)/i;
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        const cm = m.content.match(COUNTRY_RX);
        if (cm) {
          const c = cm[1].trim();
          return `Only the currency symbol of ${c}.`;
        }
      }
    }

    // ---- Recovery person-name follow-up: "Only the name of the person, one
    // line." after "Tell me about <topic>." → "Who is associated with
    // <topic>? Last name only."
    if (/^only\s+the\s+name\s+of\s+the\s+person\b/i.test(trimmed)
        || /^(?:just\s+|only\s+)?(?:the\s+)?(?:last\s+name|name)\s+(?:of\s+the\s+person\s+)?only\b/i.test(trimmed)) {
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        const am = m.content.match(/\btell\s+me\s+about\s+(.+?)[.?!]?\s*$/i);
        if (am) {
          const topic = am[1].trim();
          return `Who is associated with ${topic}? Last name only.`;
        }
      }
    }

    // ---- Planet moons follow-up: "How many moons does it have?" after
    // "Tell me about <planet>." → "How many moons does <planet> have?"
    if (/^how\s+many\s+moons\s+does\s+it\s+have\b/i.test(trimmed)) {
      const PLANETS = ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'];
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        const lc = m.content.toLowerCase();
        const found = PLANETS.find((p) => new RegExp(`\\b${p}\\b`, 'i').test(lc));
        if (found) {
          const P = found[0].toUpperCase() + found.slice(1);
          return `How many moons does ${P} have?`;
        }
      }
    }

    // Pull the prior USER message (look back through history, skipping the
    // current one which is appended last).
    let priorUser: string | null = null;
    for (let i = history.length - 2; i >= 0; i--) {
      const m = history[i];
      if (m && m.role === 'user' && typeof m.content === 'string') {
        priorUser = m.content;
        break;
      }
    }
    if (!priorUser) return null;
    const priorLower = priorUser.toLowerCase();

    // Walk further back through prior user turns to find a frame-bearing
    // message. Multi-step chains like "capital of france?" → "and germany?"
    // → "and japan?" lose the frame on the most recent user turn — fall
    // back to the most recent frame-bearing turn.
    const FRAME_RX = /\b(?:capital\s+of|ceo\s+of|who\s+founded|tell\s+me\s+about|facts?\s+about|bullet\s+points?\s+about|compare\s+|what\s+year|name\s+(?:a|an|one)\b|pick\s+(?:a|an|one)\b|give\s+(?:me\s+)?(?:a|an|one)\b|suggest\s+(?:a|an|one)\b|list\s+\d+\b|name\s+\d+\b)/i;
    let frameUser = priorUser;
    let frameLower = priorLower;
    if (!FRAME_RX.test(frameLower)) {
      for (let i = history.length - 3; i >= 0; i -= 1) {
        const m = history[i];
        if (m && m.role === 'user' && typeof m.content === 'string' && FRAME_RX.test(m.content)) {
          frameUser = m.content;
          frameLower = m.content.toLowerCase();
          break;
        }
      }
    }

    // ---- Contradiction / correction: "wait, I meant the X" /
    // "actually, I meant the X" / "sorry, I meant X". When prior frame was
    // "tell me about Y the Z", swap sense Z→X. When prior frame was
    // "capital of Y" / "ceo of Y", swap topic Y→X.
    const meantSense = trimmed.match(/^(?:wait|actually|sorry|hmm|hold\s+on)[,.\s]+(?:I\s+)?(?:meant|mean)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9\- ]*?)\s*\.?$/i);
    if (meantSense) {
      const newSense = meantSense[1].trim().toLowerCase();
      const KNOWN_SENSES = ['programming language', 'language', 'snake', 'planet', 'element', 'island', 'country', 'company', 'fruit', 'river', 'bird', 'roman god', 'god'];
      const isSense = KNOWN_SENSES.includes(newSense);
      const dis = frameUser.match(/\b([A-Za-z]+)\s+the\s+(programming\s+language|language|snake|planet|element|island|country|company|fruit|river|bird|roman\s+god|god)\b/i);
      if (dis && isSense) return `tell me about ${dis[1]} the ${newSense}`;
      if (/\bcapital\s+of\b/i.test(frameLower)) return `what is the capital of ${meantSense[1].trim()}?`;
      if (/\bceo\s+of\b/i.test(frameLower)) return `who is the ceo of ${meantSense[1].trim()}?`;
      if (/\btell\s+me\s+about\b/i.test(frameLower)) return `tell me about ${meantSense[1].trim()}`;
      if (dis && !isSense) return `tell me about ${dis[1]} the ${newSense}`;
    }

    // ---- Re-shape contradiction: "actually do it as bullet points instead"
    const reshape = trimmed.match(/^(?:actually|wait|sorry|hmm)[,.\s]+(?:do\s+it|do\s+that|do\s+the\s+same|make\s+it|format\s+it|give\s+it)\s+(?:as\s+)?(?:a\s+)?(?:in\s+)?(numbered\s+list|bullet\s+points?|bullets?|table|markdown\s+table|json|csv)\b[\s\S]*$/i);
    if (reshape) {
      const newShape = reshape[1].toLowerCase();
      const aboutMatch = frameUser.match(/\babout\s+([a-z][a-z0-9\- ]+?)(?:\s+as\s+|[?.!,]|$)/i);
      if (aboutMatch) {
        const topic = aboutMatch[1].trim();
        if (/bullet/.test(newShape)) return `5 facts about ${topic} as bullet points`;
        if (/numbered/.test(newShape)) return `5 facts about ${topic} as a numbered list`;
        if (/table/.test(newShape)) return `facts about ${topic} as a markdown table`;
        if (/json/.test(newShape)) return `give me information about ${topic} as a json object with keys name, capital, continent`;
        if (/csv/.test(newShape)) return `list facts about ${topic} as csv`;
      }
      // Fallback: when prior frame was a pick set ("name a planet" /
      // "name a european capital"), rewrite to a list-of-N over that
      // category so the negation/list router can render the new shape.
      const PICK_PLURAL: Array<{rx: RegExp; phrase: string}> = [
        { rx: /\bplanets?\b/i, phrase: 'planets' },
        { rx: /\beuropean\s+capital/i, phrase: 'european capitals' },
        { rx: /\basian\s+countr/i, phrase: 'asian countries' },
        { rx: /\bprogramming\s+language/i, phrase: 'programming languages' },
        { rx: /\btech\s+ceo|ceo\s+of\s+(?:a\s+)?tech/i, phrase: 'tech CEOs' },
        { rx: /\bchemical\s+element|periodic\s+table/i, phrase: 'chemical elements' },
      ];
      // Search prior user turns (not just frame) for a category-bearing
      // anchor. Prior turn might be "list 3 of them ..." which lost the
      // category itself — walk back further.
      let categoryPhrase: string | null = null;
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        const lc = m.content.toLowerCase();
        for (const p of PICK_PLURAL) {
          if (p.rx.test(lc)) { categoryPhrase = p.phrase; break; }
        }
        if (categoryPhrase) break;
      }
      if (categoryPhrase) {
        // Collect accumulated exclusions.
        const excludes = new Set<string>();
        for (let i = 0; i < history.length; i += 1) {
          const m = history[i];
          if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
          const negM = m.content.match(/\b(?:not|other\s+than|except|excluding|but\s+not)\s+([a-z][a-z\s,]+?)(?:[?.!]|$)/i);
          if (negM) {
            for (const piece of negM[1].split(/,| or /i)) {
              const v = piece.trim();
              if (v && v.length < 30) excludes.add(v);
            }
          }
        }
        const exclList = Array.from(excludes);
        const exclTail = exclList.length > 0 ? ` excluding ${exclList.join(' and ')}` : '';
        const fmt = /bullet/.test(newShape) ? 'as bullet points' : /numbered/.test(newShape) ? 'as a numbered list' : '';
        if (fmt) return `list 3 ${categoryPhrase}${exclTail} ${fmt}`;
      }
    }

    // ---- "list/give N of them ..." — "them" refers to a prior pick set.
    // Resolve to "list N <category-plural> ..." using the prior frame, and
    // collect prior exclusions ("one that is not X") so the new list
    // respects the chain's accumulated forbid set.
    const ofThem = trimmed.match(/^(?:please\s+)?(list|give\s+me|give|name|show\s+me|show)\s+(\d{1,2})\s+of\s+them\b\s*(.*)$/i)
      ?? trimmed.match(/^(?:please\s+)?(list|give\s+me|give|name|show\s+me|show)\s+(\d{1,2})\s+again\b\s*(.*)$/i);
    if (ofThem) {
      const count = ofThem[2];
      const tail = (ofThem[3] || '').trim();
      const PICK_PLURAL: Array<{rx: RegExp; phrase: string}> = [
        { rx: /\bplanets?\b/i, phrase: 'planets' },
        { rx: /\beuropean\s+capital/i, phrase: 'european capitals' },
        { rx: /\basian\s+countr/i, phrase: 'asian countries' },
        { rx: /\bprogramming\s+language/i, phrase: 'programming languages' },
        { rx: /\btech\s+ceo|ceo\s+of\s+(?:a\s+)?tech/i, phrase: 'tech CEOs' },
        { rx: /\bchemical\s+element|periodic\s+table/i, phrase: 'chemical elements' },
      ];
      // Walk all prior user turns to find a category-bearing frame.
      let categoryPhrase: string | null = null;
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        const lc = m.content.toLowerCase();
        for (const p of PICK_PLURAL) {
          if (p.rx.test(lc)) { categoryPhrase = p.phrase; break; }
        }
        if (categoryPhrase) break;
      }
      if (categoryPhrase) {
        // Collect accumulated exclusions from prior user turns.
        const excludes = new Set<string>();
        for (let i = 0; i < history.length; i += 1) {
          const m = history[i];
          if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
          const negM = m.content.match(/\b(?:not|other\s+than|except|excluding|but\s+not)\s+([a-z][a-z\s,]+?)(?:[?.!]|$)/i);
          if (negM) {
            for (const piece of negM[1].split(/,| or /i)) {
              const v = piece.trim();
              if (v && v.length < 30) excludes.add(v);
            }
          }
        }
        const exclList = Array.from(excludes);
        const exclTail = exclList.length > 0 ? ` excluding ${exclList.join(' and ')}` : '';
        return `list ${count} ${categoryPhrase}${exclTail}${tail ? ' ' + tail : ''}`.trim();
      }
    }

    // ---- Count revision: "actually make it 5 instead" — keep prior shape,
    // swap the count. Walks back to the most recent user turn that has an
    // explicit count (\d+) and replaces it with the new number.
    const reviseCount = trimmed.match(/^(?:actually|wait|hmm|sorry)[,.\s]*(?:make|do)\s+it\s+(\d{1,2})(?:\s+instead)?\.?\s*$/i);
    if (reviseCount) {
      const newCount = reviseCount[1];
      let countFrame: string | null = null;
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (m && m.role === 'user' && typeof m.content === 'string' && /\b\d+\b/.test(m.content) && /\b(?:list|name|give|pick|show|suggest|facts?\s+about)\b/i.test(m.content)) {
          countFrame = m.content;
          break;
        }
      }
      if (countFrame) {
        return countFrame.replace(/\b\d{1,2}\b/, newCount);
      }
    }

    // ---- Topic-swap patterns: "and X?", "what about X?", "how about X?"
    const topicSwap = trimmed.match(/^(?:please\s+)?(?:and|what\s+about|how\s+about|what['']?s\s+about|and\s+what\s+about|now\s+what\s+about)\s+([A-Za-z][A-Za-z0-9\- ]*?)\s*\??\.?$/i);
    if (topicSwap) {
      const newTopic = topicSwap[1].trim();
      // Frame: "capital of X"
      if (/\bcapital\s+of\s+[a-z]/i.test(frameLower)) return `what is the capital of ${newTopic}?`;
      // Frame: "ceo of X"
      if (/\bceo\s+of\s+[a-z]/i.test(frameLower)) return `who is the ceo of ${newTopic}?`;
      // Frame: "who founded X"
      if (/\bwho\s+founded\s+[a-z]/i.test(frameLower)) return `who founded ${newTopic}?`;
      // Frame: "tell me about X" -> just swap topic
      if (/\btell\s+me\s+about\s+[a-z]/i.test(frameLower)) return `tell me about ${newTopic}`;
      // Frame: "what year was X" — generic year query
      if (/\bwhat\s+year\b/i.test(frameLower)) return frameUser.replace(/\b([a-z][a-z\s]+?)\s*\??$/i, newTopic + '?');
    }

    // ---- Bare topic with "?" — single token(s) ending in ? inheriting the
    // most recent picker verb across noise turns. e.g. "germany?" after
    // "what is the capital of france?" → "what is the capital of germany?".
    // Walk back through ALL prior user turns (skipping affirmations/noise)
    // to find a frame with a known picker verb.
    const bareTopic = trimmed.match(/^([A-Za-z][A-Za-z0-9\-]*(?:\s+[A-Za-z][A-Za-z0-9\-]*){0,2})\s*\?\.?$/);
    if (bareTopic) {
      const newTopic = bareTopic[1].trim();
      // Reject any topic containing question/auxiliary words — those are
      // full questions, not bare topic inheritance. Single-token noise
      // words are also skipped.
      const hasVerby = /\b(?:is|are|was|were|am|be|been|being|do|does|did|will|would|should|could|can|may|might|has|have|had|who|what|when|where|why|how|which)\b/i.test(newTopic);
      const isNoise = /^(?:and|what|how|why|who|when|where|which|the|a|an|please|sorry|wait|actually|hmm|cool|thanks|ok|okay|yes|no|sure|right|nice|interesting|got|alright)$/i.test(newTopic);
      if (!hasVerby && !isNoise) {
        for (let i = history.length - 2; i >= 0; i -= 1) {
          const m = history[i];
          if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
          const cand = m.content.toLowerCase();
          if (/\bcapital\s+of\s+[a-z]/i.test(cand)) return `what is the capital of ${newTopic}?`;
          if (/\bceo\s+of\s+[a-z]/i.test(cand)) return `who is the ceo of ${newTopic}?`;
          if (/\bwho\s+founded\s+[a-z]/i.test(cand)) return `who founded ${newTopic}?`;
          if (/\bwhat\s+year\b/i.test(cand) && /\b(?:released|came\s+out|first|invented|created|founded|born)\b/i.test(cand)) {
            return `what year was ${newTopic} first released?`;
          }
          if (/\btell\s+me\s+about\s+[a-z]/i.test(cand)) return `tell me about ${newTopic}`;
        }
      }
    }

    // ---- Re-shape patterns: "now do the same for X" / "now do that for X"
    const sameFor = trimmed.match(/^(?:please\s+)?now\s+(?:do\s+(?:the\s+same|that|the\s+same\s+thing)|same\s+thing|do\s+it)\s+for\s+([A-Za-z][A-Za-z0-9\- ]*)\s*\??\.?$/i);
    if (sameFor) {
      const newTopic = sameFor[1].trim();
      // Replace the topic word inside the FRAME turn (so multi-step "do same
      // for X" → "do same for Y" chains keep the original shape).
      const factsAbout = frameUser.match(/^(.*\bfacts?\s+about\s+)([a-z][a-z\s]+?)(\s+as\s+.+|\s*\??\.?)$/i);
      if (factsAbout) return `${factsAbout[1]}${newTopic}${factsAbout[3]}`;
      const bulletsAbout = frameUser.match(/^(.*\bbullet\s+points?\s+about\s+)([a-z][a-z\s]+?)(\s*\??\.?)$/i);
      if (bulletsAbout) return `${bulletsAbout[1]}${newTopic}${bulletsAbout[3]}`;
      // Generic: append " for X" using prior frame's first verb.
      if (/\bcapital\s+of\b/i.test(frameLower)) return `what is the capital of ${newTopic}?`;
      if (/\bceo\s+of\b/i.test(frameLower)) return `who is the ceo of ${newTopic}?`;
    }

    // ---- Re-shape pair: "now compare A and B (the same way)"
    const comparePair = trimmed.match(/^(?:please\s+)?now\s+compare\s+([A-Za-z][A-Za-z0-9+#./\-]*)\s+(?:and|vs\.?|versus)\s+([A-Za-z][A-Za-z0-9+#./\-]*)\b(?:[^?]*?)\s*\??\.?$/i);
    if (comparePair) {
      const a = comparePair[1].trim();
      const b = comparePair[2].trim();
      // Carry shape from prior turn if it asked for a markdown table.
      const wantsTable = /\bmarkdown\s+table\b|\bas\s+(?:a\s+)?(?:markdown\s+)?table\b/i.test(frameLower);
      if (wantsTable) return `compare ${a} and ${b} as a markdown table`;
      return `compare ${a} and ${b}`;
    }

    // ---- Person coreference: input contains "he" / "she" / "his" / "her"
    // referring to a person named in the prior assistant turn. Walk back
    // through the most recent assistant turn and extract the first **bold**
    // proper noun (1–3 tokens) as the antecedent.
    if (/\b(?:he|she|his|her|him)\b/i.test(trimmed)) {
      let priorAssistant: string | null = null;
      for (let i = history.length - 2; i >= 0; i--) {
        const m = history[i];
        if (m && m.role === 'assistant' && typeof m.content === 'string') { priorAssistant = m.content; break; }
      }
      if (priorAssistant) {
        const nameMatch = priorAssistant.match(/\*\*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,2})\*\*/);
        if (nameMatch) {
          const person = nameMatch[1];
          let rewritten = trimmed
            .replace(/\bhis\b/gi, `${person}'s`)
            .replace(/\bher\b(?=\s+(?:nationality|age|company|firm|role|job|wife|husband|son|daughter|career|birthplace|education))/gi, `${person}'s`)
            .replace(/\b(?:he|she|him)\b/gi, person);
          rewritten = rewritten.replace(/^what\s+about\b/i, 'what is');
          return rewritten;
        }
      }
    }

    // ---- Coreference: input contains "it" / "its" referring to prior topic.
    // Examples: "who created it?", "what does it eat?", "what about its capital?"
    if (/\b(?:it|its|that)\b/i.test(trimmed)) {
      // Extract prior topic — prefer "X the Y" disambiguated topic, else
      // the substantive noun after "about" / "of" in the prior turn.
      // Walk back through ALL prior user turns to find the first frame
      // that yields a concrete topic (the most recent frame may itself
      // be coreferential, e.g. "what year was it released?").
      let priorTopic: string | null = null;
      for (let i = history.length - 2; i >= 0 && !priorTopic; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        const candidate = m.content;
        const disambig = candidate.match(/\b([A-Za-z]+)\s+the\s+(programming\s+language|language|snake|planet|element|island|country|company|fruit|river|bird|roman\s+god|god)\b/i);
        if (disambig) { priorTopic = `${disambig[1]} the ${disambig[2]}`; break; }
        const aboutMatch = candidate.match(/\babout\s+([a-z][a-z0-9\- ]+?)(?:[?.!,]|$)/i);
        if (aboutMatch) { priorTopic = aboutMatch[1].trim(); break; }
        const ofMatch = candidate.match(/\b(?:capital|ceo|founder|president|chancellor)\s+of\s+([a-z][a-z\s]+?)(?:[?.!,]|$)/i);
        if (ofMatch) { priorTopic = ofMatch[1].trim(); break; }
      }
      if (priorTopic) {
        // "what does it eat?" / "who created it?" / "what about its capital?"
        let rewritten = trimmed
          .replace(/\bits\b/gi, `${priorTopic}'s`)
          .replace(/\bit\b/gi, priorTopic);
        // "what about X's capital?" → "what is X's capital?"
        rewritten = rewritten.replace(/^what\s+about\b/i, 'what is');
        return rewritten;
      }
    }

    // ---- Pick-chain coreference: "another one" / "one more" / "another"
    // re-emits the framing turn so the negation/pick handler can pick again.
    if (/^(?:another\s+one|another|one\s+more|give\s+me\s+another|another\s+please)\.?\??$/i.test(trimmed)) {
      if (/\b(?:name|pick|give|suggest|list)\s+(?:a|an|one|\d+)\b/i.test(frameLower)) return frameUser;
    }

    // ---- Lowercase undo: re-emit the most recent list/pick frame so the
    // engine produces a fresh response in normal caps. The chat() flow's
    // lowercase post-pass already detects undo cues and skips lowering.
    if (/\b(?:never\s+mind|scratch|skip|forget|drop|cancel|wait,?\s*no|undo)\b[^.!?]*\blower[-\s]?case\b/i.test(trimmed)
        || /\b(?:use|with)\s+(?:normal|proper|regular)\s+(?:caps?|capitalization|case)\b/i.test(trimmed)
        || /^\s*(?:in\s+)?normal\s+caps\s*(?:now)?\.?$/i.test(trimmed)
        || /^\s*use\s+normal\s+caps\s*(?:now)?\.?$/i.test(trimmed)) {
      // Walk back to most recent list/pick frame and re-emit it.
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
        if (/\b(?:list|name|give\s+me|pick|suggest)\s+\d+\b/i.test(m.content)) return m.content;
      }
    }

    // ---- Ordinal recall is handled by tryAnswerEarlyHooks (direct answer).

    // ---- Mid-chain reset: "forget that — start over with X. name one." /
    // "let's start fresh with Y" — strip the reset preamble so downstream
    // routes only see the fresh request.
    const reset = trimmed.match(/^(?:forget\s+(?:that|all\s+that)|let'?s\s+start\s+(?:over|fresh)|start\s+over)[\s,\-—.]+(?:with\s+)?(.+)$/i);
    if (reset) {
      return reset[1].trim();
    }

    // ---- Pick-chain negation: "one that is not X" / "one other than X" /
    // "one except X" / "one more, not X" — stitch onto the prior pick frame
    // so the negation handler sees both the category and the forbidden items.
    const pickNeg = trimmed.match(/^(?:and\s+)?(?:one\s+more|another\s+one|one|another)(?:[,\s]+(?:that\s+(?:is\s+)?not|other\s+than|except|excluding|but\s+not|not))\s+(.+?)\.?\??$/i);
    if (pickNeg) {
      // Prefer a "name a/an/one CATEGORY" frame even if a more recent
      // "list N of them" frame was found by the generic walker — the
      // category-bearing pick frame is what the negation handler needs.
      let pickFrame: string | null = null;
      const PICK_FRAME_RX = /\b(?:name|pick|give(?:\s+me)?|suggest)\s+(?:a|an|one)\b/i;
      for (let i = history.length - 2; i >= 0; i -= 1) {
        const m = history[i];
        if (m && m.role === 'user' && typeof m.content === 'string' && PICK_FRAME_RX.test(m.content)) {
          pickFrame = m.content;
          break;
        }
      }
      const target = pickFrame ?? frameUser;
      if (/\b(?:name|pick|give|suggest|list)\s+(?:a|an|one|\d+)\b/i.test(target.toLowerCase())) {
        // Accumulate exclusions from the entire chain so a 10-turn pick
        // sequence doesn't re-suggest items already used or rejected.
        const excludes = new Set<string>();
        const addExcludes = (s: string): void => {
          const re = /(?:not|other\s+than|except|excluding|but\s+not)\s+([a-z][a-z0-9+#\s.,]*?)(?=[?.!]|$)/gi;
          let m: RegExpExecArray | null;
          while ((m = re.exec(s)) !== null) {
            const raw = m[1].trim();
            for (const part of raw.split(/\s*(?:,|\bor\b|\band\b)\s*/i)) {
              const v = part.trim().toLowerCase();
              if (v && v.length < 40) excludes.add(v);
            }
          }
        };
        for (let i = 0; i < history.length - 1; i += 1) {
          const m = history[i];
          if (m && m.role === 'user' && typeof m.content === 'string') addExcludes(m.content);
          // Also exclude items that prior assistant turns already named, so a
          // pick chain steadily expands the forbidden set across turns.
          if (m && m.role === 'assistant' && typeof m.content === 'string') {
            const boldRe = /\*\*([A-Z][A-Za-z0-9+#.\- ]{1,30})\*\*/g;
            let bm: RegExpExecArray | null;
            while ((bm = boldRe.exec(m.content)) !== null) {
              excludes.add(bm[1].trim().toLowerCase());
            }
          }
        }
        addExcludes(pickNeg[1]);
        // pickNeg[1] is the bare forbidden text from the CURRENT turn
        // (e.g. "earth", "jupiter or saturn"); addExcludes only matches
        // explicit negators so add the raw split here.
        for (const part of pickNeg[1].split(/\s*(?:,|\bor\b|\band\b)\s*/i)) {
          const v = part.trim().toLowerCase();
          if (v && v.length < 40) excludes.add(v);
        }
        const list = Array.from(excludes).join(' or ');
        return `${target.replace(/[?.!]\s*$/, '')} that is not ${list || pickNeg[1].trim()}`;
      }
    }

    return null;
  }
