/** Immutable v4 sealed-wave manifest, committed before first Vai execution. */
export const V4_MANIFEST = Object.freeze({
  suiteId: 'reasoning-spectrum-v4-sealed',
  frozenAt: '2026-07-19T12:47:00Z',
  scenarioCount: 60,
  turnCount: 72,
  familyCount: 20,
  suiteFingerprint: '714abf15e1b457c63a6a10bd40b6fd7b0de0d67f35269a5145158bc342d20786',
  suiteSourceFingerprint: '67dc9d6f70bdc02539aea06e3be104c6531aa6976e9b3047439b1fab3e4f15d4',
  scorerFingerprint: '973124d1addfc55ac39d38a0c4bdc869085a6f2cea44a6934065d926f43bf350',
  reportCoreFingerprint: 'fd7b674ad7bbe26a18643d551f1f12d26adc760b29356a21711dc0f1f8abf61e',
  preExposureCandidateFingerprint: '37c0c0fa69fc876e09d7cf47f0c19947621f5f3d03472a0d326c0cc95b7cb4d1',
  oraclePolicy: 'All 72 materialized reference turns must pass strict typed or semantic-certificate scoring before Vai executes.',
  retirementPolicy: 'This wave becomes regression-only immediately after first Vai exposure; a new commitment is required for further unseen claims.',
});
