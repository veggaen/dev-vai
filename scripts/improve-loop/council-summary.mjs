const EMPTY_MARKERS = new Set(['', '-', '--', '---', '—', 'n/a', 'none', 'null', 'undefined']);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function meaningful(value) {
  const text = clean(value);
  return text && !EMPTY_MARKERS.has(text.toLowerCase()) ? text : '';
}

function asPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n > 1 ? n / 100 : n) * 100);
}

function memberName(member) {
  return meaningful(member.name)
    || meaningful(member.memberName)
    || meaningful(member.displayName)
    || meaningful(member.memberId)
    || meaningful(member.id)
    || 'council member';
}

function detailLines(member) {
  const lines = [];
  const intent = meaningful(member.realIntent);
  const lesson = meaningful(member.methodLesson);
  const capability = meaningful(member.missingCapability);
  const action = meaningful(member.suggestedAction || member.action);
  const note = meaningful(member.note || member.preview || member.summary);
  const concerns = Array.isArray(member.concerns)
    ? member.concerns.map(meaningful).filter(Boolean)
    : [];

  if (intent) lines.push(`intent: ${intent}`);
  if (lesson) lines.push(`fix: ${lesson}`);
  if (capability) lines.push(`missing capability: ${capability}`);
  if (action && action !== 'answer-directly') lines.push(`action: ${action}`);
  if (concerns.length) lines.push(`concerns: ${concerns.join('; ')}`);
  if (note && !lines.some((line) => line.includes(note))) lines.push(`note: ${note}`);
  return lines.map((line) => line.slice(0, 420));
}

export function summarizeCouncilMember(member) {
  const details = detailLines(member);
  const useful = details.length > 0 && !member.pending && !member.failed && !member.error;
  const verdict = meaningful(member.verdict) || meaningful(member.status) || 'note';
  return {
    useful,
    pending: Boolean(member.pending),
    failed: Boolean(member.failed || member.error),
    name: memberName(member),
    verdict,
    confidence: asPercent(member.confidence),
    details,
  };
}

export function summarizeCouncilMembers(members) {
  const summaries = (members || []).map(summarizeCouncilMember);
  return {
    total: summaries.length,
    useful: summaries.filter((m) => m.useful),
    failed: summaries.filter((m) => m.failed),
    pending: summaries.filter((m) => m.pending),
    all: summaries,
  };
}

export function formatCouncilSummary(members) {
  const summary = summarizeCouncilMembers(members);
  const lines = [`Council: ${summary.useful.length}/${summary.total} responded`];
  if (summary.useful.length === 0 && summary.total > 0) {
    lines.push('Council detail: members returned no actionable note fields');
  }
  for (const member of summary.useful) {
    lines.push('');
    lines.push(`- ${member.name} - ${member.verdict}@${member.confidence}%`);
    for (const detail of member.details) lines.push(`  ${detail}`);
  }
  return lines.join('\n');
}

export function extractCouncilFixLines(output) {
  const lines = String(output ?? '').split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/^- .+/.test(line)) {
      if (current) blocks.push(current.join('\n'));
      current = [line];
    } else if (current && /^  \S/.test(line)) {
      current.push(line);
    } else if (current) {
      blocks.push(current.join('\n'));
      current = null;
    }
  }
  if (current) blocks.push(current.join('\n'));
  return blocks.join('\n').slice(0, 1200);
}
