/** Immutable v3 soundness-pack manifest, locked before first Vai exposure. */
export const V3_MANIFEST = Object.freeze({
  suiteId: 'reasoning-spectrum-v3',
  pack: 'soundness',
  frozenAt: '2026-07-19',
  scenarioCount: 140,
  turnCount: 170,
  familyCount: 14,
  suiteFingerprint: 'f7ef13d374be24d9715dba3355b714c7be75c2549620b93363a4d164affb4314',
  scorerFingerprint: '6ab37cae6fef41a7a9d7fc7bbaef1e6e997c306b0b2ee3e3e2ae7afeeb7026ec',
  reportCoreFingerprint: 'fd7b674ad7bbe26a18643d551f1f12d26adc760b29356a21711dc0f1f8abf61e',
  oraclePolicy: 'All 140 typed references must pass strict v3 scoring before Vai executes.',
  packs: Object.freeze({
    soundness: Object.freeze({
      scenarioCount: 140, turnCount: 170, familyCount: 14,
      suiteFingerprint: 'f7ef13d374be24d9715dba3355b714c7be75c2549620b93363a4d164affb4314',
    }),
    frontier: Object.freeze({
      scenarioCount: 41, turnCount: 49, familyCount: 41,
      suiteFingerprint: '6e2620a5719304fe6f649715e4e33dafa51c33eb829eb959983a5344f077688e',
    }),
    fresh: Object.freeze({
      scenarioCount: 28, turnCount: 36, familyCount: 14,
      suiteFingerprint: '3aa253b73d5fc2b04e5a51beadf3cfc648c83b4bd2d5ff6b86028b164c7c4834',
    }),
    all: Object.freeze({
      scenarioCount: 209, turnCount: 255, familyCount: 69,
      suiteFingerprint: '4192974e486376d9f28667a18b1d10ebae1d71d87ca1de5b9daf3f0232c19803',
    }),
  }),
});
