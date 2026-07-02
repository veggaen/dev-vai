import { describe, it, expect } from 'vitest';
import { tryFrameworkDevopsKnowledge } from './framework-devops-knowledge.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Regression lock for decomposition phase 2, slice 2: `tryFrameworkDevopsKnowledge` (2791-line body)
 * was moved out of the VaiEngine god-class, with its 5 real dependencies injected as a `deps` object.
 * Contract: the in-class wrapper and the free function must return IDENTICAL output for every input.
 *
 * Note: several `this.` in the body are inside knowledge-string CODE EXAMPLES (an Angular UserService
 * with this.http/this.name) — display content, correctly NOT rewritten. Only the 5 genuine deps were.
 */

const PROBES = [
  'what is kubernetes', 'explain docker containers', 'how do microservices work', 'what is ci/cd',
  'explain devops', 'what is terraform', 'how does helm work', 'what is nginx load balancing',
  'explain kafka message queues', 'what is redis caching', 'how does elasticsearch work',
  'what is a saga pattern', 'explain grpc', 'what is event-driven architecture', 'how does service discovery work',
  'what is incident response', 'explain observability', 'what is horizontal scaling', 'how do containers differ from vms',
  'what is docker compose', 'explain kubernetes pods', 'what is a deployment in k8s',
  'tell me more about kubernetes', 'what about docker networking', 'and caching strategies?',
  // Angular auth example that renders this.http/this.name in a code block — proves string content is untouched
  'how do i add authentication in angular', 'explain oauth authorization flow', 'what is sso',
  // rejection / non-topic
  'what is the weather', 'write me a poem', 'what is 2 plus 2', 'hello there',
  'what is the capital of france', 'build me a todo app',
];

describe('framework-devops-knowledge extraction', () => {
  it('exports the extracted answerer', () => {
    expect(typeof tryFrameworkDevopsKnowledge).toBe('function');
  });

  it('the VaiEngine wrapper and the free function return identical output byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true } as unknown as ConstructorParameters<typeof VaiEngine>[0]);
    const asAny = engine as unknown as {
      tryFrameworkDevopsKnowledge: (input: string) => string | null;
      normalizeFollowUpTopic: (raw: string) => string;
      findExactTopicEntry: (topic: string) => unknown;
      findCuratedShortTopicPrimer: (topic: string) => unknown;
      formatShortTopicPrimer: (primer: unknown) => string;
      skillRouter: { isExplicitScaffoldRequest(input: string): boolean };
    };
    // deps bound from the same engine instance the wrapper uses.
    const deps = {
      normalizeFollowUpTopic: (raw: string) => asAny.normalizeFollowUpTopic(raw),
      findExactTopicEntry: (topic: string) => asAny.findExactTopicEntry(topic) as never,
      findCuratedShortTopicPrimer: (topic: string) => asAny.findCuratedShortTopicPrimer(topic) as never,
      formatShortTopicPrimer: (primer: never) => asAny.formatShortTopicPrimer(primer),
      skillRouter: asAny.skillRouter,
    };
    for (const input of PROBES) {
      const viaWrapper = asAny.tryFrameworkDevopsKnowledge(input);
      const viaFree = tryFrameworkDevopsKnowledge(input, deps);
      expect(viaFree, `free(${JSON.stringify(input)})`).toBe(viaWrapper);
    }
  });

  it('the extracted function has no REAL `this.` dependency (only string-embedded examples)', () => {
    const src = tryFrameworkDevopsKnowledge.toString();
    // Every remaining `this.` must be inside a string literal (the Angular code examples).
    // A cheap proxy: the only member names after `this.` are http/name/userService (the example),
    // never the 5 real deps (which are now deps.*).
    const realDep = /this\.(normalizeFollowUpTopic|findExactTopicEntry|findCuratedShortTopicPrimer|formatShortTopicPrimer|skillRouter)\b/;
    expect(realDep.test(src)).toBe(false);
  });
});
