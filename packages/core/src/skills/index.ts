export { SkillRegistry, getSkillRegistry } from './registry.js';
export { SubAgentRouter, getSubAgentRouter } from './sub-agent-router.js';
export { TeacherAgent, getTeacherAgent } from './teacher-agent.js';
export type { RoutedTask } from './sub-agent-router.js';
export type { TeacherDecision } from './teacher-agent.js';
export type {
  SkillManifest,
  LoadedSkill,
  SkillTool,
  SkillPermission,
  SkillTrust,
  SubAgentRole,
  SubAgentConfig,
  AgentTask,
  AgentTaskResult,
  EvidenceBlock,
  CitedAnswer,
  ProvenanceRecord,
  TraceSpan,
  LearnedUnit,
  LearnedFrom,
  LearnedKind,
} from './types.js';
