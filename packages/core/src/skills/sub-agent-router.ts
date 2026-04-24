/**
 * Sub-Agent Router
 *
 * Determines which sub-agent role(s) should handle a given task,
 * assigns relevant skills, and builds the system context for each agent.
 *
 * This is the central dispatch layer for Vai's multi-agent pipeline.
 */

import type {
  SubAgentRole,
  SubAgentConfig,
  AgentTask,
  LoadedSkill,
} from './types.js';
import { getSkillRegistry } from './registry.js';

// ── Intent classifiers ────────────────────────────────────────────

const RESEARCH_PATTERNS = [
  /\b(?:what\s+is|what\s+are|who\s+is|who\s+are|when\s+did|where\s+is|how\s+does|how\s+do|explain|define|describe|tell\s+me\s+about)\b/i,
  /\b(?:latest|current|2024|2025|2026|now|today|recent|news|update)\b/i,
  /\b(?:compare|difference|vs|versus|better|worse|pros|cons|tradeoffs?)\b/i,
  /\b(?:research|investigate|deep\s+dive|find\s+out|look\s+up|google|search)\b/i,
];

const CODE_PATTERNS = [
  /\b(?:write|generate|create|build|implement|code|function|class|component|hook|api|endpoint|route)\b/i,
  /\b(?:fix|debug|bug|error|broken|failing|crash|exception|traceback|lint)\b/i,
  /\b(?:refactor|clean\s*up|optimize|improve|rewrite|migrate|upgrade)\b/i,
  /```[\s\S]*?```/.source,
  /\b(?:typescript|javascript|python|rust|go|react|node|next\.?js)\b/i,
];

const VERIFY_PATTERNS = [
  /\b(?:verify|validate|check|test|confirm|ensure|does\s+this\s+work|will\s+this\s+work|correct)\b/i,
  /\b(?:compile|build|run|execute|lint)\b/i,
];

const PLAN_PATTERNS = [
  /\b(?:plan|design|architect|structure|outline|steps|roadmap|approach|strategy|how\s+should\s+i)\b/i,
  /\b(?:before\s+(?:i|we)\s+(?:start|build|code|implement))\b/i,
];

const BROWSE_PATTERNS = [
  /https?:\/\//i,
  /\b(?:open|visit|browse|navigate\s+to|read\s+(?:this|the)\s+(?:page|article|link|url|post))\b/i,
];

const SYNTHESIZE_PATTERNS = [
  /\b(?:summarize|summary|tldr|tl;dr|short|brief|in\s+short|in\s+a\s+nutshell|what\s+does\s+it\s+say)\b/i,
  /\b(?:cite|sources?|references?|bibliography|where\s+does|according\s+to|based\s+on)\b/i,
];

// ── Role scoring ──────────────────────────────────────────────────

interface RoleScore {
  role: SubAgentRole;
  score: number;
  skills: string[];
}

function scoreRoles(input: string): RoleScore[] {
  const scores: RoleScore[] = [];

  // Researcher
  let researchScore = 0;
  for (const p of RESEARCH_PATTERNS) {
    if (p.test(input)) researchScore += 1;
  }
  if (researchScore > 0) {
    scores.push({ role: 'researcher', score: researchScore, skills: ['research-agent', 'web-search', 'fact-extractor'] });
  }

  // Coder
  let codeScore = 0;
  for (const p of CODE_PATTERNS) {
    if (new RegExp(p).test(input)) codeScore += 1;
  }
  if (codeScore > 0) {
    scores.push({ role: 'coder', score: codeScore, skills: ['code-verifier'] });
  }

  // Verifier
  let verifyScore = 0;
  for (const p of VERIFY_PATTERNS) {
    if (p.test(input)) verifyScore += 1;
  }
  if (verifyScore > 0) {
    scores.push({ role: 'verifier', score: verifyScore, skills: ['code-verifier'] });
  }

  // Planner
  let planScore = 0;
  for (const p of PLAN_PATTERNS) {
    if (p.test(input)) planScore += 1;
  }
  if (planScore > 0) {
    scores.push({ role: 'planner', score: planScore, skills: [] });
  }

  // Browser
  let browseScore = 0;
  for (const p of BROWSE_PATTERNS) {
    if (p.test(input)) browseScore += 2; // URLs are high-signal
  }
  if (browseScore > 0) {
    scores.push({ role: 'browser', score: browseScore, skills: ['browser-research', 'fact-extractor'] });
  }

  // Synthesizer
  let synthScore = 0;
  for (const p of SYNTHESIZE_PATTERNS) {
    if (p.test(input)) synthScore += 1;
  }
  if (synthScore > 0) {
    scores.push({ role: 'synthesizer', score: synthScore, skills: ['citation-composer'] });
  }

  // Fallback to general
  if (scores.length === 0) {
    scores.push({ role: 'general', score: 0.5, skills: [] });
  }

  return scores.sort((a, b) => b.score - a.score);
}

// ── SubAgentRouter ────────────────────────────────────────────────

export interface RoutedTask {
  /** Primary role to handle this task */
  primaryRole: SubAgentRole;
  /** Supporting roles (if pipeline needed) */
  supportingRoles: SubAgentRole[];
  /** Combined unique skill list for primary agent */
  primarySkills: LoadedSkill[];
  /** System context string to inject (built from skill instructions) */
  systemContext: string;
  /** Estimated pipeline depth (1 = single agent, 2+ = multi-step) */
  depth: number;
}

export class SubAgentRouter {
  /**
   * Route a user input to the appropriate agent role(s) with skill assignments.
   */
  route(input: string): RoutedTask {
    const registry = getSkillRegistry();
    const roleScores = scoreRoles(input);

    // Also match skills by trigger keywords
    const triggerSkills = registry.matchForQuery(input);

    const primary = roleScores[0];
    const supporting = roleScores.slice(1, 3).map(r => r.role);

    // Combine role-assigned skills + trigger-matched skills
    const skillNames = new Set<string>([
      ...primary.skills,
      ...triggerSkills.slice(0, 2).map(s => s.manifest.name),
    ]);

    // Resolve to LoadedSkill objects (with deps)
    const primarySkills: LoadedSkill[] = [];
    const seenSkills = new Set<string>();
    for (const name of skillNames) {
      const resolved = registry.resolveDeps(name);
      for (const skill of resolved) {
        if (!seenSkills.has(skill.manifest.name)) {
          seenSkills.add(skill.manifest.name);
          primarySkills.push(skill);
        }
      }
    }

    // Build system context from the primary skill (most relevant)
    const primarySkillName = primary.skills[0] ?? triggerSkills[0]?.manifest.name;
    const systemContext = primarySkillName ? registry.buildContext(primarySkillName) : '';

    // Multi-agent depth: research + synthesize = depth 2, research + verify + cite = depth 3
    const depth = supporting.length > 0 ? Math.min(supporting.length + 1, 3) : 1;

    return {
      primaryRole: primary.role,
      supportingRoles: supporting,
      primarySkills,
      systemContext,
      depth,
    };
  }

  /**
   * Build an AgentTask from a user message and route it.
   */
  buildTask(input: string, parentTaskId?: string): AgentTask & { routing: RoutedTask } {
    const routing = this.route(input);
    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: routing.primaryRole,
      input,
      skills: routing.primarySkills.map(s => s.manifest.name),
      parentTaskId,
    };
    return { ...task, routing };
  }

  /**
   * Get a SubAgentConfig for a given role with appropriate skills attached.
   */
  configForRole(role: SubAgentRole, extraSkills: string[] = []): SubAgentConfig {
    const registry = getSkillRegistry();

    const defaultSkillsByRole: Record<SubAgentRole, string[]> = {
      researcher: ['research-agent', 'web-search', 'fact-extractor'],
      browser: ['browser-research', 'fact-extractor'],
      synthesizer: ['citation-composer', 'fact-extractor'],
      coder: ['code-verifier'],
      verifier: ['code-verifier'],
      planner: [],
      teacher: [],
      general: [],
    };

    const skillNames = [...new Set([...defaultSkillsByRole[role], ...extraSkills])];
    const skills = skillNames.filter(name => registry.get(name) !== undefined);

    // Build system prompt from skill instructions
    const systemPromptParts: string[] = [];
    for (const name of skills) {
      const ctx = registry.buildContext(name);
      if (ctx) systemPromptParts.push(ctx);
    }

    return {
      role,
      skills,
      systemPrompt: systemPromptParts.join('\n\n---\n\n') || undefined,
      maxHistoryMessages: role === 'researcher' ? 6 : role === 'coder' ? 12 : 8,
    };
  }

  /**
   * Describe the routing decision in plain English (for debugging/tracing).
   */
  describe(input: string): string {
    const { primaryRole, supportingRoles, primarySkills, depth } = this.route(input);
    const skillNames = primarySkills.map(s => s.manifest.name).join(', ') || 'none';
    const support = supportingRoles.length > 0 ? ` + [${supportingRoles.join(', ')}]` : '';
    return `Route: ${primaryRole}${support} | Skills: ${skillNames} | Depth: ${depth}`;
  }
}

// Singleton
let _router: SubAgentRouter | null = null;
export function getSubAgentRouter(): SubAgentRouter {
  if (!_router) _router = new SubAgentRouter();
  return _router;
}
