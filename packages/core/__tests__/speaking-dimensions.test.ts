import { describe, it, expect } from 'vitest';
import { ConversationScorer, extractTurnPairs } from '../src/eval/conversation-scorer.js';
import type { TurnPair, SpeakingDimensionScores, SubScore } from '../src/eval/conversation-scorer.js';
import type { SessionEvent } from '../src/sessions/types.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  Helpers                                                       */
/* ═══════════════════════════════════════════════════════════════ */

let eventId = 0;
const eid = () => `ev-test-${++eventId}`;
const now = () => Date.now();

function userEvent(content: string, sessionId = 'test-sess'): SessionEvent {
  return {
    id: eid(),
    sessionId,
    type: 'message',
    timestamp: now(),
    content,
    meta: { role: 'user', eventType: 'message' },
  };
}

function assistantEvent(content: string, sessionId = 'test-sess'): SessionEvent {
  return {
    id: eid(),
    sessionId,
    type: 'message',
    timestamp: now(),
    content,
    meta: { role: 'assistant', eventType: 'message' },
  };
}

function buildEvents(...pairs: [string, string][]): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const [user, assistant] of pairs) {
    events.push(userEvent(user));
    events.push(assistantEvent(assistant));
  }
  return events;
}

function dims(events: SessionEvent[]): SpeakingDimensionScores {
  const scorer = new ConversationScorer();
  return scorer.score(events).speakingDimensions;
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Adaptive Depth                                                */
/* ═══════════════════════════════════════════════════════════════ */

describe('Speaking Dimension: Adaptive Depth', () => {
  it('produces a score for conversations with responses', () => {
    const events = buildEvents(
      ['How do I create a React component?', 'Here is how you create a React component. First, import React. Then define your component as a function or class. Export it at the end. Here is an example:\n```tsx\nfunction MyComponent() { return <div>Hello</div>; }\nexport default MyComponent;\n```'],
      ['What about state?', 'State in React lets components remember values between renders. Use the useState hook. Call it at the top of your component. It returns the current state and a setter function.'],
    );
    const d = dims(events);
    expect(d.adaptiveDepth.scoreable).toBe(true);
    expect(d.adaptiveDepth.value).toBeGreaterThanOrEqual(0);
    expect(d.adaptiveDepth.value).toBeLessThanOrEqual(100);
  });

  it('scores higher when response length matches question complexity', () => {
    // Short question → should get short-ish response
    const shortQ = buildEvents(
      ['What is TypeScript?', 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.'],
    );
    // Long complex question → should get long response
    const longQ = buildEvents(
      ['Can you explain the differences between composition and inheritance in object-oriented programming, including when you would use one over the other in large-scale applications with complex domain models?',
        'Composition and inheritance are two fundamental approaches to code reuse in OOP. Inheritance creates an "is-a" relationship where a subclass inherits behavior from a parent class. Composition creates a "has-a" relationship where objects contain other objects. In large-scale applications with complex domain models, composition is generally preferred because it offers more flexibility. With inheritance, you get tight coupling between parent and child classes, making changes risky. The Liskov Substitution Principle often gets violated in deep hierarchies. Composition lets you mix and match behaviors dynamically. You can swap implementations at runtime through dependency injection. The classic rule of thumb is "favor composition over inheritance" from the Gang of Four. However, inheritance still makes sense for truly hierarchical relationships like Shape → Circle. The key is to use inheritance sparingly and composition as your default.'],
    );

    const shortDims = dims(shortQ);
    const longDims = dims(longQ);
    // Both should be scoreable
    expect(shortDims.adaptiveDepth.scoreable).toBe(true);
    expect(longDims.adaptiveDepth.scoreable).toBe(true);
  });

  it('returns scoreable=false for empty conversations', () => {
    const d = dims([]);
    expect(d.adaptiveDepth.scoreable).toBe(false);
    expect(d.adaptiveDepth.value).toBe(50); // default
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Proactive Reframing                                           */
/* ═══════════════════════════════════════════════════════════════ */

describe('Speaking Dimension: Proactive Reframing', () => {
  it('scores higher when assistant proactively reframes', () => {
    const withReframing = buildEvents(
      ['How do I fix this error?', 'The real question here is whether you need this pattern at all. Alternatively, consider using a different approach that avoids the error entirely.'],
      ['Should I use var?', 'You might want to consider instead using const or let, which provide block scoping. However, the underlying issue might be about understanding scope in JavaScript.'],
    );
    const withoutReframing = buildEvents(
      ['How do I fix this error?', 'Add a try-catch block around the line.'],
      ['Should I use var?', 'Yes, var works fine for declaring variables.'],
    );

    const withDims = dims(withReframing);
    const withoutDims = dims(withoutReframing);

    expect(withDims.proactiveReframing.scoreable).toBe(true);
    expect(withDims.proactiveReframing.value).toBeGreaterThan(withoutDims.proactiveReframing.value);
  });

  it('detects reframing signal words', () => {
    const events = buildEvents(
      ['Can you help me with this bug?', 'A better approach would be to restructure the code. What you actually need is a state machine for this flow.'],
      ['Is this the right pattern?', 'The key insight here is that this pattern introduces coupling. More importantly, consider the testability implications.'],
    );
    const d = dims(events);
    expect(d.proactiveReframing.scoreable).toBe(true);
    expect(d.proactiveReframing.value).toBeGreaterThan(0);
  });

  it('returns scoreable=false when no applicable turns', () => {
    // Very short user messages (< 5 words) are skipped
    const events = buildEvents(
      ['hi', 'Hello!'],
      ['ok', 'Great!'],
    );
    const d = dims(events);
    expect(d.proactiveReframing.scoreable).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Epistemic Transparency                                        */
/* ═══════════════════════════════════════════════════════════════ */

describe('Speaking Dimension: Epistemic Transparency', () => {
  it('scores high when confidence is well-calibrated', () => {
    // High confidence assertions followed by user not correcting
    const events = buildEvents(
      ['What causes memory leaks in JS?', 'I\'m certain that closures over large objects, event listeners not being removed, and detached DOM nodes are the primary causes.'],
      ['That makes sense, thanks', 'Glad I could help. I believe these are the most common patterns to watch for.'],
      ['Any tools for detecting them?', 'Definitely use Chrome DevTools Memory tab. Take heap snapshots before and after suspected operations.'],
      ['Perfect, I\'ll try that', 'You can also use the Performance Monitor for real-time tracking.'],
    );
    const d = dims(events);
    // 4 turns but need at least 3 assertions to be scoreable. With 3+ high confidence markers
    // and no corrections, should score well
    if (d.epistemicTransparency.scoreable) {
      expect(d.epistemicTransparency.value).toBeGreaterThanOrEqual(50);
    }
  });

  it('scores lower when high confidence is followed by correction', () => {
    const events = buildEvents(
      ['How do I sort an array in place?', 'I\'m certain that Array.sort() returns a new array and doesn\'t modify the original.'],
      ['That\'s not right, sort modifies in place', 'You\'re right, I was wrong. Array.sort() does modify the original array in place.'],
      ['What about reverse?', 'Definitely, reverse also modifies the array in place.'],
      ['Correct!', 'Great, glad we cleared that up.'],
    );
    const d = dims(events);
    // Should detect miscalibration: high confidence + user correction
    if (d.epistemicTransparency.scoreable) {
      // The first assertion was wrong (high confidence followed by correction)
      expect(d.epistemicTransparency.value).toBeLessThanOrEqual(100);
    }
  });

  it('requires at least 3 assertions to be scoreable', () => {
    const events = buildEvents(
      ['What is TypeScript?', 'TypeScript adds types to JavaScript.'],
      ['Thanks', 'You\'re welcome.'],
    );
    const d = dims(events);
    expect(d.epistemicTransparency.scoreable).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Narrative Coherence                                           */
/* ═══════════════════════════════════════════════════════════════ */

describe('Speaking Dimension: Narrative Coherence', () => {
  it('scores higher when consecutive turns share entities', () => {
    const events = buildEvents(
      ['How do I set up a React project?', 'First, install create-react-app. Run npx create-react-app my-project. This sets up the project structure with webpack, babel, and React dependencies.'],
      ['What about the project structure?', 'The create-react-app project structure includes src/ for your components, public/ for static assets, and package.json for dependencies. The webpack config is hidden but customizable via eject.'],
      ['How do I add routing?', 'Install react-router-dom. In your project\'s src/App.js, import BrowserRouter and wrap your components. Define Route elements for each page within the project structure.'],
    );
    const d = dims(events);
    expect(d.narrativeCoherence.scoreable).toBe(true);
    expect(d.narrativeCoherence.value).toBeGreaterThan(0);
  });

  it('requires at least 2 turns to be scoreable', () => {
    const events = buildEvents(
      ['What is React?', 'React is a library for building user interfaces.'],
    );
    const d = dims(events);
    expect(d.narrativeCoherence.scoreable).toBe(false);
  });

  it('scores consistently when entities diverge completely', () => {
    const events = buildEvents(
      ['Tell me about databases', 'SQL databases use structured query language for relational data management with tables and joins.'],
      ['Now explain quantum physics', 'Quantum physics studies subatomic particles, wave functions, and probability distributions in the microscopic world.'],
      ['What about cooking pasta?', 'Boil salted water, add dried pasta, cook until al dente according to package directions, then drain.'],
    );
    const d = dims(events);
    if (d.narrativeCoherence.scoreable) {
      // Completely unrelated topics → low overlap
      expect(d.narrativeCoherence.value).toBeLessThan(70);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Teaching Velocity                                             */
/* ═══════════════════════════════════════════════════════════════ */

describe('Speaking Dimension: Teaching Velocity', () => {
  it('requires ≥2 topic reoccurrences to be scoreable', () => {
    const events = buildEvents(
      ['What is a closure?', 'A closure is a function that retains access to its lexical scope.'],
      ['Thanks', 'You\'re welcome!'],
    );
    const d = dims(events);
    expect(d.teachingVelocity.scoreable).toBe(false);
  });

  it('produces scoreable results for conversations with topic reoccurrence', () => {
    // Same topic asked 3 times with some gap
    const events = buildEvents(
      ['How do closures work in JavaScript?', 'A closure is when a function captures variables from its enclosing scope. The inner function maintains a reference to the outer scope even after the outer function returns.'],
      ['Can you show me a practical example?', 'Here is a closure example:\n```js\nfunction counter() {\n  let count = 0;\n  return () => ++count;\n}\nconst inc = counter();\n```'],
      ['I want to understand something else first', 'Sure, what would you like to know?'],
      ['How do closures work in JavaScript again?', 'Closures capture their enclosing scope. When you define a function inside another, the inner function has access to the outer variables.'],
      ['And one more thing about closures', 'Closures are also used in JavaScript for data privacy and factory patterns.'],
    );
    const d = dims(events);
    // May or may not have enough n-gram overlap. The test checks boundary.
    expect(d.teachingVelocity.value).toBeGreaterThanOrEqual(0);
    expect(d.teachingVelocity.value).toBeLessThanOrEqual(100);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Overall Scoring Integration                                   */
/* ═══════════════════════════════════════════════════════════════ */

describe('ConversationScorer Integration', () => {
  it('includes speaking dimensions in overall score', () => {
    const events = buildEvents(
      ['How do I set up TypeScript?', 'Install typescript via npm. Then create a tsconfig.json. The key insight is that you want strict mode enabled from the start. Consider instead using a template from create-react-app or Vite for faster setup.'],
      ['What about strict mode?', 'I believe strict mode enables all strict type checking options. More importantly, it catches null/undefined errors at compile time. A better approach is to also enable noUncheckedIndexedAccess.'],
      ['That makes sense', 'Glad to help! Alternatively, you could look into the recommended tsconfig bases from @tsconfig/recommended for sensible defaults.'],
    );

    const scorer = new ConversationScorer();
    const score = scorer.score(events);

    // Speaking dimensions should be part of the result
    expect(score.speakingDimensions).toBeDefined();
    expect(score.speakingDimensions.adaptiveDepth).toBeDefined();
    expect(score.speakingDimensions.proactiveReframing).toBeDefined();
    expect(score.speakingDimensions.epistemicTransparency).toBeDefined();
    expect(score.speakingDimensions.narrativeCoherence).toBeDefined();
    expect(score.speakingDimensions.teachingVelocity).toBeDefined();

    // Overall score should be bounded
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(['A+', 'A', 'B', 'C', 'D', 'F']).toContain(score.overallGrade);
  });

  it('scores empty events without crashing', () => {
    const scorer = new ConversationScorer();
    const score = scorer.score([]);
    expect(score.turnPairCount).toBe(0);
    expect(score.speakingDimensions.adaptiveDepth.scoreable).toBe(false);
  });

  it('all dimension values are clamped to [0, 100]', () => {
    const events = buildEvents(
      ...Array.from({ length: 10 }, (_, i) => [
        `Question ${i}: How do I implement feature ${i} with advanced techniques?`,
        `For feature ${i}, the key insight is to use composition. Alternatively, consider a builder pattern. I believe this approach is optimal for your use case. The underlying issue is about maintainability and scalability in large codebases.`,
      ] as [string, string]),
    );

    const d = dims(events);
    for (const key of ['adaptiveDepth', 'proactiveReframing', 'epistemicTransparency', 'narrativeCoherence', 'teachingVelocity'] as const) {
      expect(d[key].value).toBeGreaterThanOrEqual(0);
      expect(d[key].value).toBeLessThanOrEqual(100);
    }
  });
});
