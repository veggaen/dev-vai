import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_DEFAULTS, loadLoopConfig } from './loop-config.mjs';

// ── The behaviour-preserving contract ─────────────────────────────────────────
// Every default is pinned to the literal the codebase shipped with when the config
// module was extracted (2026-07-02). If one of these fails, either the extraction
// changed behaviour (a bug) or someone re-tuned a knob (update the pin DELIBERATELY).

test('defaults pin: process-engine knobs', () => {
  assert.equal(LOOP_DEFAULTS.densityFloor, 0.05);
  assert.equal(LOOP_DEFAULTS.minCost, 0.25);
  assert.equal(LOOP_DEFAULTS.maxDepth, 12);
});

test('defaults pin: acceptance-verifier knobs', () => {
  assert.equal(LOOP_DEFAULTS.acceptRate, 0.8);
  assert.equal(LOOP_DEFAULTS.improveRate, 0.25);
});

test('defaults pin: change-worth knobs', () => {
  assert.equal(LOOP_DEFAULTS.worthPassScore, 0.66);
  assert.deepEqual(LOOP_DEFAULTS.dimensionWeights, {
    meaningfulness: 0.35, engineeringQuality: 0.30, configurability: 0.15, futureProofness: 0.20,
  });
});

test('defaults pin: compute-roi knobs', () => {
  assert.equal(LOOP_DEFAULTS.qualityBar, 7);
  assert.equal(LOOP_DEFAULTS.roiFloor, 0.05);
  assert.equal(LOOP_DEFAULTS.roiEps, 0.01);
});

test('defaults pin: innovation-engine knobs', () => {
  assert.equal(LOOP_DEFAULTS.minMotionSample, 8);
  assert.equal(LOOP_DEFAULTS.retryCooldown, 3);
});

test('defaults pin: meaning-selector lane weights', () => {
  assert.deepEqual(LOOP_DEFAULTS.laneWeights, {
    quality: 1.0, capability: 0.9, codebase: 0.85, reliability: 0.8, routing: 0.7,
  });
});

test('defaults pin: operator + supervisor cadence', () => {
  assert.equal(LOOP_DEFAULTS.watchPort, 4123);
  assert.equal(LOOP_DEFAULTS.restSeconds, 45);
  assert.equal(LOOP_DEFAULTS.computeBudget, 10);
  assert.equal(LOOP_DEFAULTS.evictOnRest, true);
});

// ── loadLoopConfig: layering + sources ────────────────────────────────────────

test('no overrides → every value is the default, every source is "default"', () => {
  const { config, sources } = loadLoopConfig({ env: {}, argv: [] });
  assert.deepEqual(config, LOOP_DEFAULTS);
  for (const key of Object.keys(LOOP_DEFAULTS)) assert.equal(sources[key], 'default');
});

test('env override: VAI_LOOP_DENSITY_FLOOR', () => {
  const { config, sources } = loadLoopConfig({ env: { VAI_LOOP_DENSITY_FLOOR: '0.1' }, argv: [] });
  assert.equal(config.densityFloor, 0.1);
  assert.equal(sources.densityFloor, 'env');
  assert.equal(sources.minCost, 'default');
});

test('flag override beats env (precedence: defaults ← env ← flags)', () => {
  const { config, sources } = loadLoopConfig({
    env: { VAI_LOOP_REST_SECONDS: '90' },
    argv: ['--rest', '20'],
  });
  assert.equal(config.restSeconds, 20);
  assert.equal(sources.restSeconds, 'flag');
});

test('historical flag aliases: --rest, --budget, --port', () => {
  const { config } = loadLoopConfig({ env: {}, argv: ['--rest', '30', '--budget', '5', '--port', '4200'] });
  assert.equal(config.restSeconds, 30);
  assert.equal(config.computeBudget, 5);
  assert.equal(config.watchPort, 4200);
});

test('kebab-case flags work for every key shape', () => {
  const { config } = loadLoopConfig({ env: {}, argv: ['--density-floor', '0.2', '--max-depth', '6'] });
  assert.equal(config.densityFloor, 0.2);
  assert.equal(config.maxDepth, 6);
});

test('--flag=value form is accepted', () => {
  const { config } = loadLoopConfig({ env: {}, argv: ['--rest=15'] });
  assert.equal(config.restSeconds, 15);
});

test('boolean coercion: 0/false/off/no → false, anything else → true', () => {
  for (const raw of ['0', 'false', 'off', 'no', 'OFF']) {
    const { config } = loadLoopConfig({ env: { VAI_LOOP_EVICT_ON_REST: raw }, argv: [] });
    assert.equal(config.evictOnRest, false, `raw=${raw}`);
  }
  const { config } = loadLoopConfig({ env: { VAI_LOOP_EVICT_ON_REST: '1' }, argv: [] });
  assert.equal(config.evictOnRest, true);
});

test('object override: JSON shallow-merges over the default', () => {
  const { config } = loadLoopConfig({
    env: { VAI_LOOP_LANE_WEIGHTS: '{"routing":0.9}' },
    argv: [],
  });
  assert.equal(config.laneWeights.routing, 0.9);
  assert.equal(config.laneWeights.quality, 1.0); // untouched keys keep defaults
});

test('invalid overrides keep the prior layer (tolerant, never crash)', () => {
  const { config, sources } = loadLoopConfig({
    env: { VAI_LOOP_DENSITY_FLOOR: 'not-a-number', VAI_LOOP_LANE_WEIGHTS: '{broken json' },
    argv: [],
  });
  assert.equal(config.densityFloor, 0.05);
  assert.equal(sources.densityFloor, 'default');
  assert.deepEqual(config.laneWeights, LOOP_DEFAULTS.laneWeights);
});

test('invalid flag keeps the env layer beneath it', () => {
  const { config, sources } = loadLoopConfig({
    env: { VAI_LOOP_REST_SECONDS: '90' },
    argv: ['--rest', 'garbage'],
  });
  assert.equal(config.restSeconds, 90);
  assert.equal(sources.restSeconds, 'env');
});

test('config, sources, and LOOP_DEFAULTS are frozen (incl. nested objects)', () => {
  const { config, sources } = loadLoopConfig({ env: {}, argv: [] });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(sources));
  assert.ok(Object.isFrozen(config.laneWeights));
  assert.ok(Object.isFrozen(LOOP_DEFAULTS));
  assert.ok(Object.isFrozen(LOOP_DEFAULTS.dimensionWeights));
  assert.throws(() => { config.restSeconds = 999; }, TypeError);
});
