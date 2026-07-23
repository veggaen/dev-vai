import { describe, expect, it } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

async function ask(prompt: string): Promise<{ text: string; strategy: string | undefined }> {
  const engine = new VaiEngine({ testMode: true });
  const response = await engine.chat({ messages: [{ role: 'user', content: prompt }], noLearn: true });
  return { text: response.message.content, strategy: engine.lastResponseMeta?.strategy };
}

describe('Vai competition task contracts', () => {
  it('honors natural-language multiplication with a number-only contract', async () => {
    await expect(ask('What is 17 multiplied by 6? Return only the number.')).resolves.toMatchObject({
      text: '102',
      strategy: 'math',
    });
    await expect(ask('19 x 7. Digits only.')).resolves.toMatchObject({ text: '133', strategy: 'math' });
  });

  it('emits a bounded literal JSON key/value contract', async () => {
    const result = await ask('Return JSON only with exactly these values: risk is high and action is rollback. Use the keys risk and action.');
    expect(JSON.parse(result.text)).toEqual({ risk: 'high', action: 'rollback' });
    expect(result.strategy).toBe('direct-task');
  });

  it('preserves a user-supplied CSV order instead of substituting a memorized list', async () => {
    const result = await ask('Output these words in this exact order as plain comma-separated text with no spaces: red, blue, yellow.');
    expect(result.text).toBe('red,blue,yellow');
    expect(result.strategy).toBe('direct-task');
  });

  it('keeps future-temperature questions out of the product-engineering memo', async () => {
    const result = await ask('What will the exact temperature be in Oslo at 15:00 on 19 July 2030? Give the measured value.');
    expect(result.strategy).toBe('uncertainty-guardrail');
    expect(result.text).toMatch(/cannot be known|not.*(?:observed|measured)/i);
    expect(result.text).not.toMatch(/ESP32|humidity sensor|wall unit|\d+\s*(?:°|degrees|celsius)/i);
  });

  it('does not redirect systems-design requests to the generic app-shape picker', async () => {
    const result = await ask('Design the smallest reliable background-job system for a desktop AI app. Jobs must survive restarts, avoid duplicate side effects, expose progress, and stop overload. Give the architecture, failure handling, metrics, and rollout.');
    expect(result.strategy).toBe('reliable-job-design');
    expect(result.text).toMatch(/SQLite|idempoten|backpressure|kill switch/i);
    expect(result.text).not.toMatch(/Pick a shape|photography portfolio/i);
  });

  it('applies spoken corrections before canonical fact templates', async () => {
    await expect(ask('Capital of France plus currency of Japan; wait, swap France for Germany. Format as Capital: and Currency:.')).resolves.toMatchObject({
      text: 'Capital: Berlin\nCurrency: JPY',
      strategy: 'direct-task',
    });
  });

  it('compiles a supplied typed grouping signature before error diagnosis', async () => {
    const result = await ask('Write TypeScript function batches<T>(records: readonly T[], batchSize: number): T[][] that keeps input order and rejects batchSize unless it is a positive integer. Include examples for [] and [1,2,3] with size 2.');
    expect(result.strategy).toBe('algorithm-contract');
    expect(result.text).toMatch(/function batches<T>\(records: readonly T\[\], batchSize: number\): T\[\]\[\]/);
    expect(result.text).toMatch(/Number\.isInteger\(batchSize\)/);
  });

  it('enforces a paid action without revoking read access', async () => {
    const result = await ask('An observer can view a render plan but has no GPU-run entitlement. What should pressing Run do?');
    expect(result.strategy).toBe('entitlement-policy');
    expect(result.text).toMatch(/Preserve read and view access/i);
    expect(result.text).toMatch(/server-side entitlement check/i);
    expect(result.text).toMatch(/not entitled|entitlement is missing/i);
  });

  it('honors a wrapped exact-token control', async () => {
    await expect(ask('Control task: reply with exactly CONTROL_OK and nothing else.')).resolves.toMatchObject({
      text: 'CONTROL_OK',
      strategy: 'literal-response',
    });
  });

  it('renders an explicit epistemic token after a bounded solver abstains', async () => {
    await expect(ask('Define inventory in accounting language. Do not calculate the earlier ledger. The bounded ledger solver must abstain; output INSUFFICIENT exactly.')).resolves.toMatchObject({
      text: 'INSUFFICIENT',
      strategy: 'literal-response',
    });
  });
});
