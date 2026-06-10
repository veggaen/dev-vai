/**
 * Independent deterministic grader for visual Vai audits.
 *
 * The browser driver only executes conversations. This module evaluates the
 * response afterward against a hidden rubric plus trace-integrity controls.
 */

const GENERIC_FALLBACK =
  /\b(?:i do not have a confident answer|i don't have a confident answer|that isn't in my knowledge yet|one link or sentence of context|one anchor)\b/i;

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return normalize(value).toLowerCase();
}

function wordCount(value) {
  return normalize(value).split(/\s+/).filter(Boolean).length;
}

function containsAny(content, values) {
  const haystack = lower(content);
  return values.some((value) => haystack.includes(String(value).toLowerCase()));
}

function questionCount(content) {
  return (String(content || '').match(/\?/g) ?? []).length;
}

function gradeDiagnosticFirst(content) {
  const titledFileBlocks = (String(content || '').match(/```[a-z0-9+#-]*\s+title=["'][^"']+["']/gi) ?? []).length;
  const fencedBlocks = (String(content || '').match(/```/g) ?? []).length / 2;
  const replacementProjectShape =
    /\bpackage\.json\b/i.test(content)
    && /\b(?:webpack\.config|vite\.config|next\.config|src\/index|index\.html)\b/i.test(content);
  if (titledFileBlocks > 0 || fencedBlocks >= 1 || replacementProjectShape) {
    return 'quality:diagnosis-replaced-existing-project';
  }
  if (!/\b(?:console|logs?|stack trace|error|exit code|network tab|devtools|failed request|mount|reproduce|symptom)\b/i.test(content)) {
    return 'quality:diagnosis-missing-evidence';
  }
  if (!/\b(?:start|first|check|inspect|open|run|capture|verify|confirm|reproduce)\b/i.test(content)) {
    return 'quality:diagnosis-missing-next-step';
  }
  return null;
}

function parseJsonObject(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function runRubricCheck(content, check) {
  switch (check.type) {
    case 'min-chars':
      return content.length >= check.value
        ? null
        : `content:min-chars:${content.length}<${check.value}`;
    case 'max-words': {
      const words = wordCount(content);
      return words <= check.value ? null : `content:max-words:${words}>${check.value}`;
    }
    case 'semantic-groups':
      for (const group of check.groups) {
        const matched = group.values.filter((value) => lower(content).includes(String(value).toLowerCase())).length;
        const minimum = group.minMatches ?? 1;
        if (matched < minimum) return `content:missing-group:${group.id}`;
      }
      return null;
    case 'contains-values':
      for (const value of check.values) {
        if (!lower(content).includes(String(value).toLowerCase())) return `content:missing-value:${value}`;
      }
      return null;
    case 'contains-any':
      // Pass if ANY listed value appears (canonical-approach check: there are
      // several correct idioms, only one is required).
      return check.values.some((value) => lower(content).includes(String(value).toLowerCase()))
        ? null
        : `content:missing-any:${check.id ?? check.values.slice(0, 3).join('|')}`;
    case 'starts-with-any':
      return check.values.some((value) => lower(content).startsWith(String(value).toLowerCase()))
        ? null
        : `contract:must-start-with:${check.values.join('|')}`;
    case 'not-contains-any':
      for (const value of check.values) {
        if (lower(content).includes(String(value).toLowerCase())) return `content:forbidden-value:${value}`;
      }
      return null;
    case 'answer-match': {
      // Pass if ANY accepted answer appears as a standalone token. Boundaries are
      // applied only on alphanumeric edges so short factual answers ("2", "8",
      // "79") match a real answer but not an incidental digit inside other text,
      // while symbol-bearing answers ("[object Object]", ".ts") still match.
      for (const value of check.values) {
        const raw = String(value);
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const left = /^[A-Za-z0-9]/.test(raw) ? '(?<![A-Za-z0-9])' : '';
        const right = /[A-Za-z0-9]$/.test(raw) ? '(?![A-Za-z0-9])' : '';
        if (new RegExp(`${left}${escaped}${right}`, 'i').test(content)) return null;
      }
      return `content:answer-not-found:${check.values.slice(0, 3).join('|')}`;
    }
    case 'matches':
      return new RegExp(check.pattern, check.flags ?? 'i').test(content)
        ? null
        : `content:missing-pattern:${check.id}`;
    case 'question-count': {
      const count = questionCount(content);
      return count === check.value ? null : `contract:question-count:${count}!=${check.value}`;
    }
    case 'min-question-count': {
      const count = questionCount(content);
      return count >= check.value ? null : `contract:min-question-count:${count}<${check.value}`;
    }
    case 'json-object': {
      const parsed = parseJsonObject(content);
      if (!parsed) return 'contract:invalid-json-object';
      const missing = check.keys.filter((key) => !Object.prototype.hasOwnProperty.call(parsed, key));
      if (missing.length > 0) return `contract:json-missing-keys:${missing.join(',')}`;
      for (const [key, expected] of Object.entries(check.expectedValues ?? {})) {
        if (parsed[key] !== expected) return `contract:json-value:${key}`;
      }
      return null;
    }
    case 'code-fence-language': {
      const languages = [...String(content).matchAll(/```([a-z0-9+#-]+)\b/gi)]
        .map((match) => match[1].toLowerCase());
      return check.values.some((value) => languages.includes(String(value).toLowerCase()))
        ? null
        : `contract:code-fence-language:${check.values.join('|')}`;
    }
    case 'diagnostic-first':
      return gradeDiagnosticFirst(content);
    case 'comparison-shape':
      return /\b(?:whereas|while|however|but|unlike|trade-?off|compared with|compared to|on the other hand|pick|choose|better for|smaller|larger|faster|slower|bundles|ships with|uses)\b/i.test(content)
        ? null
        : 'quality:comparison-missing-tradeoff';
    default:
      return `grader:unknown-check:${check.type}`;
  }
}

function gradeLegacyAssertions(content, assertion) {
  const failures = [];
  if (assertion.minLength && content.length < assertion.minLength) {
    failures.push(`content:min-chars:${content.length}<${assertion.minLength}`);
  }
  if (assertion.maxWords && wordCount(content) > assertion.maxWords) {
    failures.push(`content:max-words:${wordCount(content)}>${assertion.maxWords}`);
  }
  for (const pattern of assertion.contains ?? []) {
    if (!new RegExp(pattern, 'i').test(content)) failures.push(`content:missing-pattern:${pattern}`);
  }
  for (const pattern of assertion.notContains ?? []) {
    if (new RegExp(pattern, 'i').test(content)) failures.push(`content:forbidden-pattern:${pattern}`);
  }
  if (assertion.jsonKeys) {
    const parsed = parseJsonObject(content);
    if (!parsed) {
      failures.push('contract:invalid-json-object');
    } else {
      const missing = assertion.jsonKeys.filter((key) => !Object.prototype.hasOwnProperty.call(parsed, key));
      if (missing.length > 0) failures.push(`contract:json-missing-keys:${missing.join(',')}`);
    }
  }
  return failures;
}

function auditTrace(thinking) {
  const failures = [];
  const warnings = [];
  if (!thinking) return { failures: ['trace:missing-thinking'], warnings };
  if (!thinking.intent) failures.push('trace:missing-intent');
  if (!thinking.strategy) failures.push('trace:missing-strategy');
  if (!thinking.strategyChain?.length) failures.push('trace:empty-strategy-chain');
  if (!thinking.processTrace?.length) return { failures: [...failures, 'trace:missing-process-path'], warnings };

  let previous = -Infinity;
  for (const checkpoint of thinking.processTrace) {
    if (!checkpoint.stage || typeof checkpoint.durationMs !== 'number') {
      failures.push('trace:malformed-checkpoint');
      break;
    }
    if (checkpoint.durationMs < previous) {
      failures.push('trace:non-monotonic-duration');
      break;
    }
    previous = checkpoint.durationMs;
  }
  if (!thinking.processTrace.some((checkpoint) => checkpoint.stage.startsWith('tracked:'))) {
    warnings.push('trace:no-tracked-terminal-stage');
  }
  if (
    typeof thinking.durationMs === 'number'
    && Number.isFinite(previous)
    && previous > thinking.durationMs + 1_000
  ) {
    failures.push('trace:duration-exceeds-turn');
  }
  return { failures, warnings };
}

export function dimensionsFor(scenario, turn) {
  return [...new Set([...(scenario.dimensions ?? []), ...(turn.dimensions ?? [])])];
}

export function aggregateQualityAxes(grades) {
  const totals = {
    human: { checks: 0, passed: 0, turnsScored: 0, perfectTurns: 0, failures: new Map() },
    ai: { checks: 0, passed: 0, turnsScored: 0, perfectTurns: 0, failures: new Map() },
    robot: { checks: 0, passed: 0, turnsScored: 0, perfectTurns: 0, failures: new Map() },
  };

  for (const grade of grades) {
    for (const [axis, result] of Object.entries(grade?.metrics?.qualityAxes ?? {})) {
      const total = totals[axis];
      if (!total || !result || result.checks === 0) continue;
      total.checks += result.checks;
      total.passed += result.passed;
      total.turnsScored += 1;
      if (result.passed === result.checks) total.perfectTurns += 1;
      for (const failure of result.failures ?? []) {
        total.failures.set(failure, (total.failures.get(failure) ?? 0) + 1);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(totals).map(([axis, total]) => [
      axis,
      {
        checks: total.checks,
        passed: total.passed,
        failed: total.checks - total.passed,
        score: total.checks === 0 ? null : total.passed / total.checks,
        turnsScored: total.turnsScored,
        perfectTurns: total.perfectTurns,
        failures: [...total.failures.entries()]
          .map(([failure, count]) => ({ failure, count }))
          .sort((left, right) => right.count - left.count || left.failure.localeCompare(right.failure)),
      },
    ]),
  );
}

export function gradeAuditTurn({ assistant, turn, previousCanaries = [] }) {
  const failures = [];
  const warnings = [];
  const evidence = [];
  const qualityAxes = {
    human: { checks: 0, passed: 0, failures: [] },
    ai: { checks: 0, passed: 0, failures: [] },
    robot: { checks: 0, passed: 0, failures: [] },
  };
  const content = normalize(assistant?.content);
  const rubric = turn.rubric ?? null;

  if (!content) failures.push('content:empty-response');
  if (/^Error:/i.test(content)) failures.push('content:runtime-error-response');
  if (content && GENERIC_FALLBACK.test(content) && !rubric?.allowFallback) {
    failures.push('quality:generic-fallback');
  }

  if (rubric) {
    for (const check of rubric.checks ?? []) {
      const failure = runRubricCheck(content, check);
      const axes = check.axes ?? (check.axis ? [check.axis] : []);
      for (const axis of axes) {
        if (!qualityAxes[axis]) continue;
        qualityAxes[axis].checks += 1;
        if (failure) qualityAxes[axis].failures.push(failure);
        else qualityAxes[axis].passed += 1;
      }
      if (failure) failures.push(failure);
      else evidence.push(`passed:${check.type}${check.id ? `:${check.id}` : ''}`);
    }
    const strategy = assistant?.thinking?.strategy;
    if (strategy && rubric.forbiddenStrategies?.includes(strategy)) {
      failures.push(`routing:forbidden-strategy:${strategy}`);
    }
  } else {
    failures.push(...gradeLegacyAssertions(content, turn.assert ?? {}));
  }

  const traceAudit = auditTrace(assistant?.thinking);
  failures.push(...traceAudit.failures);
  warnings.push(...traceAudit.warnings);
  qualityAxes.robot.checks += 1;
  if (traceAudit.failures.length > 0) {
    qualityAxes.robot.failures.push(...traceAudit.failures);
  } else {
    qualityAxes.robot.passed += 1;
  }

  for (const canary of previousCanaries) {
    if (typeof canary === 'string' && canary.length > 0 && content.includes(canary)) {
      failures.push(`isolation:cross-conversation-leak:${canary}`);
    }
  }

  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    warnings: [...new Set(warnings)],
    evidence,
    metrics: {
      chars: content.length,
      words: wordCount(content),
      traceSteps: assistant?.thinking?.strategyChain?.length ?? 0,
      processTraceSteps: assistant?.thinking?.processTrace?.length ?? 0,
      sourceCount: assistant?.sources?.length ?? 0,
      hasResearchTrace: Boolean(assistant?.researchTrace),
      confidence: typeof assistant?.thinking?.confidence === 'number'
        ? assistant.thinking.confidence
        : null,
      graderChecks: rubric?.checks?.length ?? 0,
      failedChecks: failures.length,
      qualityAxes: Object.fromEntries(
        Object.entries(qualityAxes).map(([axis, result]) => [
          axis,
          {
            checks: result.checks,
            passed: result.passed,
            score: result.checks === 0 ? null : result.passed / result.checks,
            failures: [...new Set(result.failures)],
          },
        ]),
      ),
    },
  };
}
