import { describe, expect, it } from 'vitest';
import { createRuntimeAdaptiveDomains } from '../src/adaptive-domains.js';

describe('runtime adaptive domains', () => {
  it('does not let slow chat turns throttle tool concurrency', () => {
    const domains = createRuntimeAdaptiveDomains();

    domains.chat.observe(206_738);

    expect(domains.chat.snapshot()).toMatchObject({
      observations: 1,
      p95Latency: 206_738,
    });
    expect(domains.tools.snapshot()).toMatchObject({
      observations: 0,
      concurrency: 5,
    });
  });

  it('tracks tool latency without contaminating chat telemetry', () => {
    const domains = createRuntimeAdaptiveDomains();

    domains.tools.observe(42);

    expect(domains.tools.snapshot()).toMatchObject({
      observations: 1,
      medianLatency: 42,
    });
    expect(domains.chat.snapshot()).toMatchObject({
      observations: 0,
      medianLatency: 0,
    });
  });
});
