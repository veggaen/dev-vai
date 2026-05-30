import { describe, expect, it } from 'vitest';
import {
  hasExplicitSoftwareExecutionAnchor,
  hasProductEngineeringSignal,
  isProductEngineeringPlanningPrompt,
} from './product-engineering-intent.js';

const SENSOR_PRODUCT_PROMPT = [
  'going to make a temperature + humidity sensor and wire this into my wall',
  'I want to do this project from scratch making my own temperature measure and humidity sensor',
  'hardware with a screen and a UI to display a graph of change in data over time',
  'what hardware can I order from China, casing and similar, product for sale',
].join(' ');

describe('product-engineering intent guard', () => {
  it('detects hardware and physical-product planning prompts', () => {
    expect(hasProductEngineeringSignal(SENSOR_PRODUCT_PROMPT)).toBe(true);
    expect(isProductEngineeringPlanningPrompt(SENSOR_PRODUCT_PROMPT)).toBe(true);
  });

  it('does not block explicit software prototype requests', () => {
    const prompt = 'Prototype the web dashboard UI for my ESP32 humidity sensor in React now.';
    expect(hasProductEngineeringSignal(prompt)).toBe(true);
    expect(hasExplicitSoftwareExecutionAnchor(prompt)).toBe(true);
    expect(isProductEngineeringPlanningPrompt(prompt)).toBe(false);
  });

  it('does not treat normal software app builds as product-engineering planning', () => {
    expect(isProductEngineeringPlanningPrompt('Build me a todo app with filters and localStorage.')).toBe(false);
    expect(hasExplicitSoftwareExecutionAnchor('Build me a Next.js dashboard app.')).toBe(true);
  });
});
