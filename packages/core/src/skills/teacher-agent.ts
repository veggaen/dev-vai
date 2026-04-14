import type { CitedAnswer, EvidenceBlock, LearnedKind, LearnedUnit } from './types.js';

export interface TeacherDecision {
  readonly learnNow: readonly LearnedUnit[];
  readonly askForApproval: readonly LearnedUnit[];
  readonly reject: ReadonlyArray<{ readonly unit: LearnedUnit; readonly reason: string }>;
}

interface CandidateEvidence {
  readonly block: EvidenceBlock;
  readonly normalized: string;
}

export class TeacherAgent {
  private static readonly MIN_AUTO_CONFIDENCE = 0.78;
  private static readonly MIN_APPROVAL_CONFIDENCE = 0.58;
  private static readonly MIN_AUTO_TRUST = 0.72;
  private static readonly MIN_APPROVAL_TRUST = 0.45;

  decide(query: string, citedAnswer: CitedAnswer, userApproved = false): TeacherDecision {
    const learnNow: LearnedUnit[] = [];
    const askForApproval: LearnedUnit[] = [];
    const reject: Array<{ unit: LearnedUnit; reason: string }> = [];

    const grouped = this.groupEvidence(citedAnswer.evidence);
    const queryTags = this.extractTags(query);

    for (const group of grouped) {
      const representative = group[0].block;
      const corroborationCount = new Set(group.map(item => item.block.domain)).size;
      const avgTrust = group.reduce((sum, item) => sum + item.block.trustScore, 0) / group.length;
      const kind = this.classifyKind(representative.snippet, query);
      const confidence = this.computeConfidence(citedAnswer.confidence, avgTrust, corroborationCount);

      const unit: LearnedUnit = {
        id: `learned-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        kind,
        content: representative.snippet,
        sourceUrl: representative.url,
        sourceTitle: representative.title,
        sourceSnippet: representative.snippet,
        sourceSpan: { start: 0, end: representative.snippet.length },
        learnedFrom: 'web-search',
        confidence,
        approvedByUser: userApproved,
        createdAt: new Date().toISOString(),
        tags: [...new Set([...queryTags, representative.domain, kind])],
      };

      if (userApproved || (confidence >= TeacherAgent.MIN_AUTO_CONFIDENCE && avgTrust >= TeacherAgent.MIN_AUTO_TRUST && corroborationCount >= 2)) {
        learnNow.push(unit);
        continue;
      }

      if (confidence >= TeacherAgent.MIN_APPROVAL_CONFIDENCE && avgTrust >= TeacherAgent.MIN_APPROVAL_TRUST) {
        askForApproval.push(unit);
        continue;
      }

      reject.push({
        unit,
        reason: `insufficient support (confidence=${confidence.toFixed(2)}, trust=${avgTrust.toFixed(2)}, corroboration=${corroborationCount})`,
      });
    }

    return { learnNow, askForApproval, reject };
  }

  private groupEvidence(evidence: readonly EvidenceBlock[]): CandidateEvidence[][] {
    const groups: CandidateEvidence[][] = [];

    for (const block of evidence) {
      const normalized = this.normalizeSnippet(block.snippet);
      if (!normalized) continue;

      const existing = groups.find(group => group.some(item => item.normalized === normalized));
      if (existing) {
        existing.push({ block, normalized });
        continue;
      }

      groups.push([{ block, normalized }]);
    }

    return groups;
  }

  private normalizeSnippet(snippet: string): string {
    return snippet
      .toLowerCase()
      .replace(/\[[0-9]+\]/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  }

  private classifyKind(snippet: string, query: string): LearnedKind {
    const lower = `${query} ${snippet}`.toLowerCase();
    if (/\b(compare|versus|vs\.?|difference|better|worse|tradeoff|pros|cons)\b/.test(lower)) return 'comparison';
    if (/\b(how to|steps?|install|configure|setup|set up|run|deploy|build|create)\b/.test(lower)) return 'procedure';
    if (/```|\bfunction\b|\bclass\b|\bconst\b|\bimport\b/.test(snippet)) return 'code-snippet';
    if (/\bpattern|workflow|pipeline|strategy|architecture\b/.test(lower)) return 'pattern';
    if (/\bskill\b/.test(lower)) return 'skill';
    return 'fact';
  }

  private computeConfidence(answerConfidence: number, avgTrust: number, corroborationCount: number): number {
    const corroborationBonus = Math.min(0.18, Math.max(0, corroborationCount - 1) * 0.09);
    return Math.min(0.99, answerConfidence * 0.55 + avgTrust * 0.35 + corroborationBonus);
  }

  private extractTags(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter(token => token.length > 2)
      .slice(0, 8);
  }
}

let _teacherAgent: TeacherAgent | null = null;

export function getTeacherAgent(): TeacherAgent {
  if (_teacherAgent === null) {
    _teacherAgent = new TeacherAgent();
  }
  return _teacherAgent;
}