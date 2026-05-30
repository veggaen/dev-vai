import { describe, expect, it } from 'vitest';
import { tryEmitProductEngineeringMemo } from './product-engineering-memo.js';

describe('tryEmitProductEngineeringMemo', () => {
  it('emits a structured memo for the wall sensor product prompt', () => {
    const memo = tryEmitProductEngineeringMemo({
      content: 'I want to make a temperature and humidity wall sensor with ESP32 hardware, screen UI, graph history, SaaS dashboard, alerts, enclosure/casing, sourcing from China, and a path to sell this as a product.',
    });

    expect(memo).toMatch(/Executive Takeaway/i);
    expect(memo).toMatch(/Hardware\/BOM Sketch/i);
    expect(memo).toMatch(/Enclosure And Mechanical Constraints/i);
    expect(memo).toMatch(/SaaS\/Admin Architecture/i);
    expect(memo).toMatch(/Risks And Unknowns/i);
    expect(memo).toMatch(/Next Deeper Options/i);
    expect(memo).not.toMatch(/```|title="|{{template:|{{deploy:/);
  });

  it('does not intercept explicit software prototype requests', () => {
    expect(tryEmitProductEngineeringMemo({
      content: 'Prototype the web dashboard UI for my ESP32 humidity sensor in React now.',
    })).toBeNull();
  });
});
