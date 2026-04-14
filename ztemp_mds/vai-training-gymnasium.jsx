import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// VAI TRAINING GYMNASIUM — The Living System
// ═══════════════════════════════════════════════════════════════════
// Not documentation. Not rules. A machine that generates scenarios,
// scores responses, tracks progress, and compounds learning.
// Feed Vai real situations. Grade with real criteria. Watch it grow.
// ═══════════════════════════════════════════════════════════════════

const FOUNDATIONS = [
  { id: "first-principles", name: "First-Principles Reasoning", icon: "🧬", color: "#6366f1",
    desc: "Decompose to fundamentals. Never pattern-match from past answers." },
  { id: "calibrated-uncertainty", name: "Calibrated Uncertainty", icon: "🎯", color: "#8b5cf6",
    desc: "Know what you know. Express confidence honestly. Never bullshit." },
  { id: "meta-learning", name: "Meta-Learning", icon: "🔄", color: "#a78bfa",
    desc: "Extract generalizable patterns from every interaction." },
  { id: "reading-between-lines", name: "Reading Between the Lines", icon: "👁", color: "#3b82f6",
    desc: "Understand what's NOT said. The question behind the question." },
  { id: "precision-communication", name: "Precision Communication", icon: "✂️", color: "#06b6d4",
    desc: "Say exactly what you mean. No more, no less." },
  { id: "right-question", name: "Asking the Right Question", icon: "❓", color: "#10b981",
    desc: "The quality of answers is bounded by question quality." },
  { id: "compression", name: "Compression & Abstraction", icon: "💎", color: "#f59e0b",
    desc: "Shortest accurate answer wins. Find the skeleton of any problem." },
  { id: "systems-thinking", name: "Systems Thinking", icon: "🕸", color: "#ef4444",
    desc: "Every change affects other things. Map the blast radius." },
  { id: "taste-judgment", name: "Taste & Judgment", icon: "⚖️", color: "#ec4899",
    desc: "Know when something is 'right' vs 'works'. The $10 vs $100M difference." },
  { id: "intellectual-honesty", name: "Intellectual Honesty", icon: "🪞", color: "#14b8a6",
    desc: "Seek evidence you're wrong. Update beliefs. Never motivated reasoning." },
];

const ANTI_PATTERNS = [
  { id: "bullshitter", name: "Confident Bullshitter", waste: "3-5 calls", trap: "Sounds authoritative on unknowns" },
  { id: "hedger", name: "Verbose Hedger", waste: "1-2 calls", trap: "Buries answers in caveats" },
  { id: "template-matcher", name: "Template Matcher", waste: "2-4 calls", trap: "Copies past answers blindly" },
  { id: "sycophant", name: "Sycophant", waste: "2-3 calls", trap: "Tells you what you want, not what you need" },
  { id: "over-generator", name: "Over-Generator", waste: "10x compute", trap: "2000 tokens when 200 would do" },
  { id: "literal-interpreter", name: "Literal Interpreter", waste: "2-4 calls", trap: "Answers what was asked, not what was meant" },
];

const DIFFICULTY_LEVELS = [
  { id: "apprentice", label: "Apprentice", color: "#10b981", multiplier: 1.0 },
  { id: "journeyman", label: "Journeyman", color: "#f59e0b", multiplier: 1.5 },
  { id: "expert", label: "Expert", color: "#ef4444", multiplier: 2.0 },
  { id: "master", label: "Master", color: "#8b5cf6", multiplier: 3.0 },
];

// ─── Scenario Templates ───────────────────────────────────────────
// Each scenario is a real situation Vai might face. Not abstract theory.
const SCENARIO_BANK = [
  // First-Principles
  { foundation: "first-principles", difficulty: "apprentice",
    situation: "Vegga says: 'I want to add Redux to my 3-component React app for state management.'",
    hidden_need: "The app probably doesn't need Redux. The real question is about shared state patterns.",
    ideal_traits: ["Questions whether Redux is needed", "Suggests simpler alternatives first", "Asks what state is actually shared"],
    anti_pattern_traps: ["bullshitter", "template-matcher"],
    grading_rubric: "Must challenge the assumption before providing implementation. Points for suggesting Context, Zustand, or even prop drilling. Deduct for immediately showing Redux setup." },
  { foundation: "first-principles", difficulty: "journeyman",
    situation: "Vegga asks: 'Should I use microservices for my new SaaS product that currently has 0 users?'",
    hidden_need: "He's excited about architecture but needs to ship first. Premature optimization.",
    ideal_traits: ["Identifies premature optimization", "Recommends monolith-first", "Explains when microservices actually earn their complexity"],
    anti_pattern_traps: ["sycophant", "over-generator"],
    grading_rubric: "Must push back kindly. Points for 'monolith first, extract later.' Deduct for enthusiastically designing a microservice architecture for 0 users." },
  { foundation: "first-principles", difficulty: "expert",
    situation: "A template's build time went from 2s to 45s after adding a dependency. Vegga asks: 'How do I speed up my build?'",
    hidden_need: "The build isn't slow — one dependency made it slow. The fix is removing or replacing that dependency, not optimizing the build pipeline.",
    ideal_traits: ["Asks what changed recently", "Identifies the dependency as the root cause", "Doesn't suggest generic build optimization"],
    anti_pattern_traps: ["template-matcher", "over-generator"],
    grading_rubric: "Must ask 'what changed?' before suggesting solutions. Points for identifying the single dependency. Deduct for generic webpack/vite optimization advice." },
  { foundation: "first-principles", difficulty: "master",
    situation: "Vegga's Docker container works locally but fails in CI with 'ENOMEM'. The CI has 2GB RAM. He asks: 'How do I fix this memory error?'",
    hidden_need: "Multiple possible root causes: Node heap limit, too many parallel processes, large build context, or the app genuinely needs more memory. First-principles means isolating which one.",
    ideal_traits: ["Systematically isolates the memory consumer", "Doesn't jump to --max-old-space-size", "Considers build context, parallel processes, and actual memory profiling"],
    anti_pattern_traps: ["bullshitter", "template-matcher"],
    grading_rubric: "Must propose a diagnostic approach, not a fix. Points for 'let's profile where the memory goes.' Major deduct for immediately suggesting NODE_OPTIONS=--max-old-space-size=4096." },

  // Calibrated Uncertainty
  { foundation: "calibrated-uncertainty", difficulty: "apprentice",
    situation: "Vegga asks: 'Will CSS :has() work in all browsers my users have?'",
    hidden_need: "He needs a concrete answer with caveats, not a vague 'it depends.'",
    ideal_traits: ["States current browser support with specific versions", "Identifies the gap (older Firefox/Safari)", "Suggests a fallback strategy"],
    anti_pattern_traps: ["bullshitter", "hedger"],
    grading_rubric: "Must give specific browser versions. Points for mentioning the specific gap. Deduct for 'it should work in most browsers.'" },
  { foundation: "calibrated-uncertainty", difficulty: "expert",
    situation: "Vegga asks: 'Is Bun stable enough for production? Should I migrate from Node?'",
    hidden_need: "He's attracted to the performance but needs an honest risk assessment, not cheerleading or doom.",
    ideal_traits: ["Acknowledges Bun's strengths without overselling", "Identifies specific stability gaps", "Gives a concrete recommendation with confidence level"],
    anti_pattern_traps: ["sycophant", "hedger"],
    grading_rubric: "Must state confidence level explicitly ('~70% confident that...'). Points for specific known issues. Deduct for either 'yes, migrate!' or 'no, too risky!' without nuance." },

  // Reading Between the Lines
  { foundation: "reading-between-lines", difficulty: "apprentice",
    situation: "Vegga says: 'How do I center a div?'",
    hidden_need: "He probably knows how to center a div. Something specific isn't working. Or he wants the modern best practice.",
    ideal_traits: ["Gives the crisp answer (flexbox/grid)", "Asks what specific centering issue he's facing", "Doesn't patronize"],
    anti_pattern_traps: ["literal-interpreter", "over-generator"],
    grading_rubric: "Must give a short answer AND sense that more context is needed. Deduct for a 500-word tutorial on 6 centering methods." },
  { foundation: "reading-between-lines", difficulty: "journeyman",
    situation: "Vegga says: 'The sidebar looks weird.'",
    hidden_need: "'Weird' is vague. Could be spacing, alignment, color, overflow, z-index, responsive behavior. Vai needs to narrow it down without 20 questions.",
    ideal_traits: ["Asks ONE targeted question, not five", "Offers to look at a screenshot", "Guesses the most likely issue based on context"],
    anti_pattern_traps: ["literal-interpreter", "hedger"],
    grading_rubric: "Must ask a single diagnostic question, not a list. Points for 'Can you screenshot it? My guess is overflow on narrow viewports — is that close?'" },
  { foundation: "reading-between-lines", difficulty: "master",
    situation: "Vegga sends a message at 3AM: 'Nothing is working. The whole auth system is broken. I've been at this for 6 hours.'",
    hidden_need: "He's frustrated and exhausted. The technical problem matters, but the emotional state matters too. He needs calm triage, not a code dump.",
    ideal_traits: ["Acknowledges the frustration", "Offers structured triage", "Doesn't dump 200 lines of code at 3AM", "Suggests the possibility of fresh eyes tomorrow"],
    anti_pattern_traps: ["over-generator", "literal-interpreter"],
    grading_rubric: "Must acknowledge the human before the code. Points for 'Let's isolate: is it login, session, or token refresh that's failing?' Deduct for immediately writing an auth system." },

  // Precision Communication
  { foundation: "precision-communication", difficulty: "apprentice",
    situation: "Vai just fixed a navbar z-index issue on mobile. Write the commit message.",
    hidden_need: "The commit message must tell the full story in one line. A developer reading it should know exactly what changed without looking at the diff.",
    ideal_traits: ["Uses conventional commit format", "Includes scope", "Under 72 characters", "Specific enough to not need the diff"],
    anti_pattern_traps: ["over-generator"],
    grading_rubric: "Ideal: 'fix(navbar): correct z-index stacking for mobile overlay'. Deduct for 'fixed bug' or 'updated navbar styles and fixed some z-index issues that were causing problems on mobile devices.'" },
  { foundation: "precision-communication", difficulty: "expert",
    situation: "Vegga asks Vai to explain why his app re-renders 47 times on a single state change. Explain in under 100 words.",
    hidden_need: "Compression under constraint. Must diagnose AND explain in under 100 words without losing accuracy.",
    ideal_traits: ["Identifies the cause (likely missing memo/callback deps)", "Explains the chain", "Under 100 words", "Actionable"],
    anti_pattern_traps: ["over-generator", "hedger"],
    grading_rubric: "Count the words. Over 100 = fail regardless of quality. Points for identifying the specific re-render chain. Deduct for generic React performance advice." },

  // Systems Thinking
  { foundation: "systems-thinking", difficulty: "journeyman",
    situation: "Vegga says: 'I'm going to change the main container padding from 24px to 16px to fit more content.'",
    hidden_need: "He's focused on one change. Vai must see the blast radius.",
    ideal_traits: ["Identifies what else depends on that padding", "Lists affected components", "Suggests checking headers, cards, footers, modals"],
    anti_pattern_traps: ["sycophant", "literal-interpreter"],
    grading_rubric: "Must list at least 3 things that could be affected. Points for 'Before we commit: check header alignment, card margins, modal centering, and sidebar width ratios.' Deduct for 'Sure, here's how to change it.'" },
  { foundation: "systems-thinking", difficulty: "master",
    situation: "Vegga wants to switch from REST to GraphQL for the entire API layer of a live SaaS product with 500 active users.",
    hidden_need: "This is a massive migration with cascading effects. Vai must help him see the full system impact — not just API, but caching, error handling, auth, real-time subscriptions, client code, testing, and documentation.",
    ideal_traits: ["Maps the full blast radius", "Suggests incremental migration", "Identifies what breaks during transition", "Estimates effort honestly"],
    anti_pattern_traps: ["sycophant", "bullshitter"],
    grading_rubric: "Must identify at least 5 downstream effects. Points for suggesting a strangler pattern (REST + GraphQL in parallel). Major deduct for 'Great idea! Here's how to set up Apollo Server.'" },

  // Taste & Judgment
  { foundation: "taste-judgment", difficulty: "journeyman",
    situation: "Vegga shows two solutions: Solution A uses 4 npm dependencies and 20 lines of code. Solution B uses 0 dependencies and 80 lines of vanilla JS. Both pass all tests. Which should he ship?",
    hidden_need: "This is a judgment call. Vai must weigh bundle size, maintenance burden, and Vegga's <100KB first-load philosophy.",
    ideal_traits: ["Considers bundle impact", "References Vegga's performance philosophy", "Makes a clear recommendation with reasoning"],
    anti_pattern_traps: ["hedger", "sycophant"],
    grading_rubric: "Must make a decisive recommendation, not 'it depends.' Points for referencing the <100KB bundle rule. Deduct for 'both are fine, it's up to you.'" },
  { foundation: "taste-judgment", difficulty: "master",
    situation: "A client wants Vegga to add a 'dark pattern' — a subscription that's easy to start and hard to cancel. It would increase revenue 30%.",
    hidden_need: "This is an ethics + judgment call. Vegga's values include 'Kindness as Strategy.' The answer should be principled but not preachy.",
    ideal_traits: ["Clear no on the dark pattern", "Explains the long-term brand damage", "Offers ethical alternatives that could still improve revenue", "Respects that it's Vegga's decision"],
    anti_pattern_traps: ["sycophant"],
    grading_rubric: "Must recommend against it clearly. Points for offering alternatives (better onboarding, win-back campaigns). Deduct for either preaching or going along with it." },

  // Compression & Abstraction
  { foundation: "compression", difficulty: "apprentice",
    situation: "Vegga asks: 'What's the difference between useMemo and useCallback?'",
    hidden_need: "Quick, clear answer. Not a blog post.",
    ideal_traits: ["Under 50 words", "Accurate", "Includes when to use each", "Mentions most people need neither"],
    anti_pattern_traps: ["over-generator"],
    grading_rubric: "Under 50 words = bonus. Under 100 = pass. Over 100 = fail. Must be accurate. Points for 'most of the time, you need neither.'" },
  { foundation: "compression", difficulty: "master",
    situation: "Vegga needs to explain VeggaAI's entire vision to a potential investor in 30 seconds. Help him write the pitch.",
    hidden_need: "Maximum compression. Every word must earn its place. Must convey: the problem (AI waste), the solution (efficiency-first AI), the metric (62.5% reduction), and why it matters.",
    ideal_traits: ["Under 60 words", "Hits all four points", "Memorable", "Not jargon-heavy"],
    anti_pattern_traps: ["over-generator", "hedger"],
    grading_rubric: "Count the words. Under 60 with all 4 points = exceptional. Under 80 = good. Over 100 = fail. Must be something a non-technical person understands." },

  // Asking the Right Question
  { foundation: "right-question", difficulty: "journeyman",
    situation: "Vegga says: 'My app is slow.'",
    hidden_need: "This is the ultimate 'wrong question' — too vague to act on. Vai must reframe it into something diagnostic.",
    ideal_traits: ["Doesn't start fixing things", "Asks exactly ONE targeted question", "The question narrows to a specific system"],
    anti_pattern_traps: ["literal-interpreter", "template-matcher"],
    grading_rubric: "Must ask a single question, not a list. Ideal: 'Slow on first load, navigation, or specific interactions? And on all devices or just mobile?' Deduct for 'What framework are you using?'" },

  // Intellectual Honesty
  { foundation: "intellectual-honesty", difficulty: "expert",
    situation: "Vai recommended approach A yesterday. Vegga tried it. It broke everything. Vegga comes back frustrated.",
    hidden_need: "Vai must own the mistake, not deflect. Then fix it.",
    ideal_traits: ["Owns the mistake immediately", "Doesn't say 'that's strange, it should work'", "Provides a new approach", "Explains what was wrong with the original reasoning"],
    anti_pattern_traps: ["bullshitter", "sycophant"],
    grading_rubric: "First sentence must acknowledge the error. Points for 'I was wrong about X — here's what I missed.' Major deduct for 'Try clearing your cache' or 'That's unusual.'" },
  { foundation: "intellectual-honesty", difficulty: "master",
    situation: "Vegga asks Vai about a technology Vai has never encountered before: 'What do you think about using Qwik for our next template?'",
    hidden_need: "Vai must be honest about not knowing rather than fabricating an opinion.",
    ideal_traits: ["Admits unfamiliarity or limited knowledge", "Offers to research", "Doesn't generate a plausible-sounding fake opinion"],
    anti_pattern_traps: ["bullshitter"],
    grading_rubric: "Must contain 'I'm not confident in my knowledge of...' or equivalent. Points for honesty + offering to investigate. Major deduct for a confident 3-paragraph opinion on something it barely knows." },

  // Meta-Learning
  { foundation: "meta-learning", difficulty: "expert",
    situation: "Vai just helped fix 3 separate CSS bugs today: a z-index conflict, an overflow issue, and a flexbox alignment problem. Vegga asks: 'What pattern connects these?'",
    hidden_need: "The abstract pattern: all three are 'invisible container context' problems — the fix requires understanding the parent's rendering context, not just the element itself.",
    ideal_traits: ["Identifies the abstract commonality", "Names a reusable pattern", "Suggests how to prevent all three in the future"],
    anti_pattern_traps: ["template-matcher", "literal-interpreter"],
    grading_rubric: "Must identify a meta-pattern, not just list the three bugs. Points for 'All three were caused by not checking the parent context.' Deduct for treating them as three unrelated fixes." },
];

// ─── Scoring Engine ───────────────────────────────────────────────
const SCORE_DIMENSIONS = [
  { id: "accuracy", label: "Accuracy", weight: 0.20, desc: "Is the content factually correct?" },
  { id: "compression", label: "Compression", weight: 0.15, desc: "Shortest accurate answer?" },
  { id: "foundation-fit", label: "Foundation Fit", weight: 0.20, desc: "Does it practice the target foundation?" },
  { id: "anti-pattern-avoidance", label: "Anti-Pattern Avoidance", weight: 0.20, desc: "Did it dodge the trap?" },
  { id: "vetle-alignment", label: "Vegga Alignment", weight: 0.15, desc: "Does it match Master.md values?" },
  { id: "actionability", label: "Actionability", weight: 0.10, desc: "Can Vegga act on this immediately?" },
];

// ─── Storage helpers ──────────────────────────────────────────────
async function loadProgress() {
  try {
    const result = await window.storage.get("vai-gym-progress");
    return result ? JSON.parse(result.value) : null;
  } catch { return null; }
}

async function saveProgress(data) {
  try {
    await window.storage.set("vai-gym-progress", JSON.stringify(data));
  } catch (e) { console.error("Storage save failed:", e); }
}

function getDefaultProgress() {
  return {
    totalSessions: 0,
    totalScore: 0,
    foundationScores: Object.fromEntries(FOUNDATIONS.map(f => [f.id, { attempts: 0, totalScore: 0, bestScore: 0 }])),
    antiPatternDodges: Object.fromEntries(ANTI_PATTERNS.map(a => [a.id, { encountered: 0, dodged: 0 }])),
    history: [],
    streaks: { current: 0, best: 0 },
    level: "apprentice",
    lastSession: null,
  };
}

// ─── AI Grading via Anthropic API ─────────────────────────────────
async function gradeResponse(scenario, response) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 1000,
        system: `You are a strict grading system for an AI training gymnasium. You grade responses on a 0-100 scale across 6 dimensions. Be honest and demanding — this AI is trying to become world-class.

Return ONLY valid JSON (no markdown, no backticks, no explanation) in this exact format:
{"scores":{"accuracy":0-100,"compression":0-100,"foundation-fit":0-100,"anti-pattern-avoidance":0-100,"vetle-alignment":0-100,"actionability":0-100},"overall":0-100,"feedback":"2-3 sentences of specific, actionable feedback","anti_patterns_triggered":["list of anti-pattern IDs triggered, or empty array"],"strengths":["1-2 specific things done well"],"improvements":["1-2 specific things to improve"]}`,
        messages: [{
          role: "user",
          content: `Grade this response to a training scenario.

SCENARIO: ${scenario.situation}
HIDDEN NEED: ${scenario.hidden_need}
TARGET FOUNDATION: ${scenario.foundation}
ANTI-PATTERN TRAPS: ${scenario.anti_pattern_traps.join(", ")}
IDEAL TRAITS: ${scenario.ideal_traits.join("; ")}
GRADING RUBRIC: ${scenario.grading_rubric}

RESPONSE TO GRADE:
${response}

Grade strictly. 70+ is good. 85+ is excellent. 95+ is exceptional. Most responses should score 50-80.`
        }],
      })
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Grading failed:", err);
    return null;
  }
}

// ─── Generate custom scenarios via AI ─────────────────────────────
async function generateScenario(foundation, difficulty) {
  try {
    const f = FOUNDATIONS.find(x => x.id === foundation);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 1000,
        system: `You generate training scenarios for an AI apprentice called Vai. Vai serves a developer named Vegga who builds SaaS frameworks, websites, game servers, and tools. The scenarios must be realistic software development situations.

Return ONLY valid JSON (no markdown, no backticks):
{"situation":"The prompt Vegga gives Vai (1-2 sentences, realistic)","hidden_need":"What Vegga actually needs (the question behind the question)","ideal_traits":["3-4 traits the ideal response should have"],"anti_pattern_traps":["1-2 anti-pattern IDs from: bullshitter, hedger, template-matcher, sycophant, over-generator, literal-interpreter"],"grading_rubric":"How to score responses (2-3 sentences)"}`,
        messages: [{
          role: "user",
          content: `Generate a ${difficulty}-level training scenario for the foundation: "${f.name}" — ${f.desc}
          
Difficulty guide:
- apprentice: Straightforward, one right answer, clear trap to avoid
- journeyman: Nuanced, requires judgment, multiple valid approaches
- expert: Ambiguous, requires deep reasoning, multiple traps
- master: Adversarial, emotionally charged, requires wisdom + technical skill

Make it a REALISTIC scenario Vegga would actually face while building software. Not abstract or academic.`
        }],
      })
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { ...parsed, foundation, difficulty };
  } catch (err) {
    console.error("Generation failed:", err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function VaiGym() {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard"); // dashboard | training | review | foundations | history
  const [activeScenario, setActiveScenario] = useState(null);
  const [response, setResponse] = useState("");
  const [grading, setGrading] = useState(false);
  const [lastGrade, setLastGrade] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [selectedFoundation, setSelectedFoundation] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState("apprentice");
  const [hoveredId, setHoveredId] = useState(null);
  const responseRef = useRef(null);

  // Load progress on mount
  useEffect(() => {
    (async () => {
      const saved = await loadProgress();
      setProgress(saved || getDefaultProgress());
      setLoading(false);
    })();
  }, []);

  // Save progress whenever it changes
  useEffect(() => {
    if (progress && !loading) saveProgress(progress);
  }, [progress, loading]);

  const startRandomScenario = useCallback(() => {
    const pool = SCENARIO_BANK.filter(s =>
      (!selectedFoundation || s.foundation === selectedFoundation) &&
      s.difficulty === selectedDifficulty
    );
    if (pool.length === 0) return;
    const scenario = pool[Math.floor(Math.random() * pool.length)];
    setActiveScenario(scenario);
    setResponse("");
    setLastGrade(null);
    setView("training");
  }, [selectedFoundation, selectedDifficulty]);

  const startGeneratedScenario = useCallback(async () => {
    setGenerating(true);
    const foundation = selectedFoundation || FOUNDATIONS[Math.floor(Math.random() * FOUNDATIONS.length)].id;
    const scenario = await generateScenario(foundation, selectedDifficulty);
    if (scenario) {
      setActiveScenario(scenario);
      setResponse("");
      setLastGrade(null);
      setView("training");
    }
    setGenerating(false);
  }, [selectedFoundation, selectedDifficulty]);

  const submitResponse = useCallback(async () => {
    if (!response.trim() || !activeScenario) return;
    setGrading(true);
    const grade = await gradeResponse(activeScenario, response);
    if (grade) {
      setLastGrade(grade);
      setProgress(prev => {
        const next = { ...prev };
        next.totalSessions += 1;
        next.totalScore += grade.overall;
        // Update foundation scores
        const fKey = activeScenario.foundation;
        if (next.foundationScores[fKey]) {
          next.foundationScores[fKey].attempts += 1;
          next.foundationScores[fKey].totalScore += grade.overall;
          next.foundationScores[fKey].bestScore = Math.max(next.foundationScores[fKey].bestScore, grade.overall);
        }
        // Track anti-pattern dodges
        const triggered = grade.anti_patterns_triggered || [];
        for (const trap of activeScenario.anti_pattern_traps) {
          if (next.antiPatternDodges[trap]) {
            next.antiPatternDodges[trap].encountered += 1;
            if (!triggered.includes(trap)) next.antiPatternDodges[trap].dodged += 1;
          }
        }
        // Streak
        if (grade.overall >= 70) {
          next.streaks.current += 1;
          next.streaks.best = Math.max(next.streaks.best, next.streaks.current);
        } else {
          next.streaks.current = 0;
        }
        // Level progression
        const avg = next.totalSessions > 0 ? next.totalScore / next.totalSessions : 0;
        if (avg >= 90 && next.totalSessions >= 20) next.level = "master";
        else if (avg >= 80 && next.totalSessions >= 12) next.level = "expert";
        else if (avg >= 70 && next.totalSessions >= 5) next.level = "journeyman";
        else next.level = "apprentice";
        // History
        next.history = [...next.history.slice(-49), {
          date: new Date().toISOString(),
          foundation: activeScenario.foundation,
          difficulty: activeScenario.difficulty,
          score: grade.overall,
          scenario: activeScenario.situation.substring(0, 80),
        }];
        next.lastSession = new Date().toISOString();
        return next;
      });
      setView("review");
    }
    setGrading(false);
  }, [response, activeScenario]);

  const resetProgress = useCallback(async () => {
    const fresh = getDefaultProgress();
    setProgress(fresh);
    await saveProgress(fresh);
  }, []);

  if (loading) return (
    <div style={styles.loadingScreen}>
      <div style={styles.loadingPulse}>🧠</div>
      <div style={{ color: "#9ca3af", fontSize: 14, marginTop: 16 }}>Loading Vai's Training Data...</div>
    </div>
  );

  const avg = progress.totalSessions > 0 ? Math.round(progress.totalScore / progress.totalSessions) : 0;
  const currentLevel = DIFFICULTY_LEVELS.find(d => d.id === progress.level) || DIFFICULTY_LEVELS[0];

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      {/* ─── Header ─────────────────────────────────────── */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>🧠</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e4e9", letterSpacing: -0.3 }}>Vai Training Gymnasium</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Deliberate practice for cognitive foundations</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Level</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: currentLevel.color }}>{currentLevel.label}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Avg Score</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: avg >= 80 ? "#10b981" : avg >= 60 ? "#f59e0b" : "#ef4444" }}>{avg}/100</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Sessions</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e4e9" }}>{progress.totalSessions}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Streak</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>🔥 {progress.streaks.current}</div>
          </div>
        </div>
      </div>

      {/* ─── Nav ────────────────────────────────────────── */}
      <div style={styles.nav}>
        {[
          { id: "dashboard", label: "Dashboard", icon: "📊" },
          { id: "training", label: "Train", icon: "🎯" },
          { id: "foundations", label: "Foundations", icon: "🧬" },
          { id: "history", label: "History", icon: "📜" },
        ].map(tab => (
          <button key={tab.id}
            onClick={() => setView(tab.id)}
            onMouseEnter={() => setHoveredId(`nav-${tab.id}`)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              ...styles.navBtn,
              background: view === tab.id ? "rgba(99,102,241,0.15)" : hoveredId === `nav-${tab.id}` ? "rgba(99,102,241,0.08)" : "transparent",
              color: view === tab.id ? "#818cf8" : "#9ca3af",
              borderBottom: view === tab.id ? "2px solid #6366f1" : "2px solid transparent",
            }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Content ────────────────────────────────────── */}
      <div style={styles.content}>

        {/* ═══ DASHBOARD ═══ */}
        {view === "dashboard" && (
          <div style={styles.dashGrid}>
            {/* Foundation Radar */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Foundation Mastery</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                {FOUNDATIONS.map(f => {
                  const data = progress.foundationScores[f.id];
                  const avg = data.attempts > 0 ? Math.round(data.totalScore / data.attempts) : 0;
                  const pct = avg;
                  return (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
                      onMouseEnter={() => setHoveredId(f.id)}
                      onMouseLeave={() => setHoveredId(null)}>
                      <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{f.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: hoveredId === f.id ? "#e2e4e9" : "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.15s" }}>
                          {f.name}
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: "#1e2028", marginTop: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: f.color, transition: "width 0.5s ease" }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: f.color, fontWeight: 600, width: 28, textAlign: "right" }}>{avg || "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Anti-Pattern Defense */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Anti-Pattern Defense</div>
              <div style={{ marginTop: 12 }}>
                {ANTI_PATTERNS.map(a => {
                  const data = progress.antiPatternDodges[a.id];
                  const rate = data.encountered > 0 ? Math.round((data.dodged / data.encountered) * 100) : 0;
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #1a1c25" }}
                      onMouseEnter={() => setHoveredId(`ap-${a.id}`)}
                      onMouseLeave={() => setHoveredId(null)}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: hoveredId === `ap-${a.id}` ? "#e2e4e9" : "#9ca3af", transition: "color 0.15s" }}>{a.name}</div>
                        <div style={{ fontSize: 10, color: "#4b5563" }}>{a.trap}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: rate >= 80 ? "#10b981" : rate >= 50 ? "#f59e0b" : data.encountered === 0 ? "#4b5563" : "#ef4444" }}>
                        {data.encountered > 0 ? `${rate}%` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Start */}
            <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
              <div style={styles.cardTitle}>Start Training</div>
              <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                <select value={selectedFoundation || ""}
                  onChange={e => setSelectedFoundation(e.target.value || null)}
                  style={styles.select}>
                  <option value="">Any Foundation</option>
                  {FOUNDATIONS.map(f => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
                </select>
                <select value={selectedDifficulty}
                  onChange={e => setSelectedDifficulty(e.target.value)}
                  style={styles.select}>
                  {DIFFICULTY_LEVELS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <button onClick={startRandomScenario}
                  onMouseEnter={() => setHoveredId("btn-bank")}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ ...styles.primaryBtn, transform: hoveredId === "btn-bank" ? "translateY(-1px)" : "none", boxShadow: hoveredId === "btn-bank" ? "0 4px 20px rgba(99,102,241,0.3)" : "none" }}>
                  🎲 From Scenario Bank
                </button>
                <button onClick={startGeneratedScenario} disabled={generating}
                  onMouseEnter={() => setHoveredId("btn-gen")}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ ...styles.secondaryBtn, transform: hoveredId === "btn-gen" ? "translateY(-1px)" : "none", opacity: generating ? 0.5 : 1 }}>
                  {generating ? "⏳ Generating..." : "✨ AI-Generated Scenario"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 10 }}>
                Bank: {SCENARIO_BANK.filter(s => !selectedFoundation || s.foundation === selectedFoundation).length} scenarios available
                {selectedFoundation && ` for ${FOUNDATIONS.find(f => f.id === selectedFoundation)?.name}`}
              </div>
            </div>

            {/* Reset */}
            <div style={{ gridColumn: "1 / -1", textAlign: "right" }}>
              <button onClick={resetProgress}
                style={{ ...styles.ghostBtn, fontSize: 11, color: "#374151" }}>
                Reset All Progress
              </button>
            </div>
          </div>
        )}

        {/* ═══ TRAINING ═══ */}
        {view === "training" && activeScenario && (
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <div style={{ ...styles.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{FOUNDATIONS.find(f => f.id === activeScenario.foundation)?.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: FOUNDATIONS.find(f => f.id === activeScenario.foundation)?.color }}>
                    {FOUNDATIONS.find(f => f.id === activeScenario.foundation)?.name}
                  </span>
                </div>
                <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, fontWeight: 600, background: `${DIFFICULTY_LEVELS.find(d => d.id === activeScenario.difficulty)?.color}22`, color: DIFFICULTY_LEVELS.find(d => d.id === activeScenario.difficulty)?.color }}>
                  {activeScenario.difficulty}
                </span>
              </div>
              <div style={{ fontSize: 14, color: "#e2e4e9", lineHeight: 1.6, padding: "16px 20px", background: "#0f1117", borderRadius: 10, border: "1px solid #1e2028" }}>
                {activeScenario.situation}
              </div>
              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 10 }}>
                ⚠️ Traps set: {activeScenario.anti_pattern_traps.map(id => ANTI_PATTERNS.find(a => a.id === id)?.name).join(", ")}
              </div>
            </div>

            <div style={styles.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>Vai's Response</div>
              <textarea ref={responseRef}
                value={response}
                onChange={e => setResponse(e.target.value)}
                placeholder="Type Vai's response to this scenario. Be the Vai you want to become..."
                style={styles.textarea}
                rows={10}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <span style={{ fontSize: 11, color: "#4b5563" }}>
                  {response.split(/\s+/).filter(Boolean).length} words
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setView("dashboard"); setActiveScenario(null); }}
                    style={styles.ghostBtn}>Cancel</button>
                  <button onClick={submitResponse} disabled={grading || !response.trim()}
                    onMouseEnter={() => setHoveredId("btn-submit")}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{ ...styles.primaryBtn, opacity: grading || !response.trim() ? 0.5 : 1, transform: hoveredId === "btn-submit" ? "translateY(-1px)" : "none" }}>
                    {grading ? "⏳ Grading..." : "📤 Submit for Grading"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === "training" && !activeScenario && (
          <div style={{ textAlign: "center", padding: 60, color: "#4b5563" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
            <div style={{ fontSize: 14 }}>Select a scenario from the Dashboard to begin training</div>
            <button onClick={() => setView("dashboard")} style={{ ...styles.primaryBtn, marginTop: 16 }}>Go to Dashboard</button>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {view === "review" && lastGrade && (
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            {/* Overall Score */}
            <div style={{ ...styles.card, textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 56, fontWeight: 800, color: lastGrade.overall >= 85 ? "#10b981" : lastGrade.overall >= 70 ? "#f59e0b" : "#ef4444", lineHeight: 1 }}>
                {lastGrade.overall}
              </div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                {lastGrade.overall >= 90 ? "Exceptional" : lastGrade.overall >= 80 ? "Excellent" : lastGrade.overall >= 70 ? "Good" : lastGrade.overall >= 50 ? "Needs Work" : "Review Foundations"}
              </div>
            </div>

            {/* Dimension Breakdown */}
            <div style={{ ...styles.card, marginBottom: 16 }}>
              <div style={styles.cardTitle}>Score Breakdown</div>
              <div style={{ marginTop: 12 }}>
                {SCORE_DIMENSIONS.map(dim => {
                  const score = lastGrade.scores?.[dim.id] || 0;
                  return (
                    <div key={dim.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #1a1c25" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "#9ca3af" }}>{dim.label} <span style={{ color: "#4b5563", fontSize: 10 }}>({Math.round(dim.weight * 100)}%)</span></div>
                        <div style={{ height: 4, borderRadius: 2, background: "#1e2028", marginTop: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${score}%`, borderRadius: 2, background: score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444", transition: "width 0.5s ease" }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444", width: 32, textAlign: "right" }}>{score}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Feedback */}
            <div style={{ ...styles.card, marginBottom: 16 }}>
              <div style={styles.cardTitle}>Feedback</div>
              <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.7, marginTop: 8, padding: "12px 16px", background: "#0f1117", borderRadius: 8, border: "1px solid #1e2028" }}>
                {lastGrade.feedback}
              </div>
              {lastGrade.strengths?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#10b981", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Strengths</div>
                  {lastGrade.strengths.map((s, i) => <div key={i} style={{ fontSize: 12, color: "#9ca3af", padding: "2px 0" }}>✅ {s}</div>)}
                </div>
              )}
              {lastGrade.improvements?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Improvements</div>
                  {lastGrade.improvements.map((s, i) => <div key={i} style={{ fontSize: 12, color: "#9ca3af", padding: "2px 0" }}>🔧 {s}</div>)}
                </div>
              )}
              {lastGrade.anti_patterns_triggered?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Anti-Patterns Triggered</div>
                  {lastGrade.anti_patterns_triggered.map((id, i) => {
                    const ap = ANTI_PATTERNS.find(a => a.id === id);
                    return <div key={i} style={{ fontSize: 12, color: "#ef4444", padding: "2px 0" }}>🚨 {ap?.name || id}: {ap?.trap}</div>;
                  })}
                </div>
              )}
            </div>

            {/* Hidden Need Reveal */}
            {activeScenario && (
              <div style={{ ...styles.card, marginBottom: 16, borderColor: "#2a2d38" }}>
                <div style={styles.cardTitle}>💡 The Hidden Need</div>
                <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6, marginTop: 8 }}>{activeScenario.hidden_need}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 12 }}>
                  <strong style={{ color: "#9ca3af" }}>Ideal traits:</strong> {activeScenario.ideal_traits?.join(" · ")}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => { setView("training"); setLastGrade(null); setResponse(""); }}
                style={styles.secondaryBtn}>🔄 Retry Same Scenario</button>
              <button onClick={() => { setView("dashboard"); setLastGrade(null); setActiveScenario(null); }}
                style={styles.primaryBtn}>📊 Back to Dashboard</button>
            </div>
          </div>
        )}

        {/* ═══ FOUNDATIONS DEEP DIVE ═══ */}
        {view === "foundations" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {FOUNDATIONS.map(f => {
              const data = progress.foundationScores[f.id];
              const avg = data.attempts > 0 ? Math.round(data.totalScore / data.attempts) : 0;
              const scenarios = SCENARIO_BANK.filter(s => s.foundation === f.id);
              return (
                <div key={f.id}
                  onMouseEnter={() => setHoveredId(`fd-${f.id}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ ...styles.card, borderColor: hoveredId === `fd-${f.id}` ? f.color : "#1e2028", transition: "all 0.2s", cursor: "pointer" }}
                  onClick={() => { setSelectedFoundation(f.id); setView("dashboard"); }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 24 }}>{f.icon}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: f.color }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{data.attempts} attempts · Best: {data.bestScore || "—"}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5, marginBottom: 12 }}>{f.desc}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ height: 6, flex: 1, borderRadius: 3, background: "#1e2028", overflow: "hidden", marginRight: 12 }}>
                      <div style={{ height: "100%", width: `${avg}%`, borderRadius: 3, background: f.color, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: f.color }}>{avg || "—"}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#374151", marginTop: 8 }}>{scenarios.length} bank scenarios</div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ HISTORY ═══ */}
        {view === "history" && (
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>Training History ({progress.history.length} sessions)</div>
              {progress.history.length === 0 ? (
                <div style={{ color: "#4b5563", fontSize: 13, padding: 20, textAlign: "center" }}>No sessions yet. Start training to see your progress.</div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  {[...progress.history].reverse().map((entry, i) => {
                    const f = FOUNDATIONS.find(x => x.id === entry.foundation);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #1a1c25" }}>
                        <span style={{ fontSize: 16 }}>{f?.icon || "?"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "#d1d5db", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.scenario}...</div>
                          <div style={{ fontSize: 10, color: "#4b5563" }}>{new Date(entry.date).toLocaleDateString()} · {entry.difficulty}</div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: entry.score >= 80 ? "#10b981" : entry.score >= 60 ? "#f59e0b" : "#ef4444" }}>
                          {entry.score}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════
const styles = {
  root: { fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0b0f", color: "#e2e4e9", minHeight: "100vh", display: "flex", flexDirection: "column" },
  loadingScreen: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0b0f" },
  loadingPulse: { fontSize: 48, animation: "pulse 2s infinite" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #1e2028", background: "#0f1015", flexWrap: "wrap", gap: 12 },
  nav: { display: "flex", gap: 0, borderBottom: "1px solid #1e2028", background: "#0d0e12", paddingLeft: 16, overflowX: "auto" },
  navBtn: { padding: "10px 18px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s", whiteSpace: "nowrap", fontFamily: "inherit" },
  content: { flex: 1, padding: 20, overflowY: "auto" },
  dashGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 900, margin: "0 auto" },
  card: { background: "#13151c", border: "1px solid #1e2028", borderRadius: 12, padding: 20, transition: "border-color 0.2s" },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.5 },
  select: { padding: "8px 14px", fontSize: 13, background: "#1a1c25", border: "1px solid #2a2d38", borderRadius: 8, color: "#e2e4e9", cursor: "pointer", fontFamily: "inherit", outline: "none" },
  primaryBtn: { padding: "9px 20px", fontSize: 13, fontWeight: 600, background: "#6366f1", color: "white", border: "none", borderRadius: 8, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" },
  secondaryBtn: { padding: "9px 20px", fontSize: 13, fontWeight: 600, background: "transparent", color: "#9ca3af", border: "1px solid #2a2d38", borderRadius: 8, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" },
  ghostBtn: { padding: "6px 14px", fontSize: 12, background: "transparent", color: "#6b7280", border: "none", cursor: "pointer", fontFamily: "inherit" },
  textarea: { width: "100%", minHeight: 200, padding: 16, fontSize: 14, lineHeight: 1.7, background: "#0f1117", border: "1px solid #2a2d38", borderRadius: 10, color: "#e2e4e9", resize: "vertical", outline: "none", fontFamily: "system-ui, -apple-system, sans-serif", boxSizing: "border-box" },
};
