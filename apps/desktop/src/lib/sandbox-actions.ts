export interface DeployAction {
  stackId: string;
  tier: string;
  name: string;
}

export interface TemplateAction {
  templateId: string;
  name: string;
}

export interface ReplaceAction {
  query: string;
  replacement: string;
  paths: string[];
  expectedReplacements: number;
  summary?: string;
  details?: string[];
}

const DEPLOY_PATTERN = /\{\{deploy:(\w+):([a-z-]+):([^}]+)\}\}/g;
const TEMPLATE_PATTERN = /\{\{template:([a-z0-9-]+):([^}]+)\}\}/g;
const REPLACE_PATTERN = /\{\{replace:([^}\s]+)\}\}/g;

export function extractDeployActions(content: string): DeployAction[] {
  const actions: DeployAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = DEPLOY_PATTERN.exec(content)) !== null) {
    actions.push({ stackId: match[1], tier: match[2], name: match[3] });
  }

  return actions;
}

export function extractTemplateActions(content: string): TemplateAction[] {
  const actions: TemplateAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = TEMPLATE_PATTERN.exec(content)) !== null) {
    actions.push({ templateId: match[1], name: match[2] });
  }

  return actions;
}

export function extractReplaceActions(content: string): ReplaceAction[] {
  const actions: ReplaceAction[] = [];
  let match: RegExpExecArray | null;
  while ((match = REPLACE_PATTERN.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<ReplaceAction>;
      if (
        typeof parsed.query !== 'string'
        || parsed.query.length === 0
        || typeof parsed.replacement !== 'string'
        || !Array.isArray(parsed.paths)
        || parsed.paths.length !== 1
        || parsed.paths.some((path) => typeof path !== 'string' || path.length === 0)
        || parsed.expectedReplacements !== 1
        || (parsed.summary !== undefined && typeof parsed.summary !== 'string')
        || (
          parsed.details !== undefined
          && (!Array.isArray(parsed.details) || parsed.details.some((detail) => typeof detail !== 'string'))
        )
      ) {
        continue;
      }
      actions.push(parsed as ReplaceAction);
    } catch {
      // Malformed action markers are inert.
    }
  }
  return actions;
}

export function stripSandboxActionMarkers(content: string): string {
  return content
    .replace(DEPLOY_PATTERN, '')
    .replace(TEMPLATE_PATTERN, '')
    .replace(REPLACE_PATTERN, '')
    .trim();
}
