export interface DeployAction {
  stackId: string;
  tier: string;
  name: string;
}

export interface TemplateAction {
  templateId: string;
  name: string;
}

const DEPLOY_PATTERN = /\{\{deploy:(\w+):([a-z-]+):([^}]+)\}\}/g;
const TEMPLATE_PATTERN = /\{\{template:([a-z0-9-]+):([^}]+)\}\}/g;

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

export function stripSandboxActionMarkers(content: string): string {
  return content.replace(DEPLOY_PATTERN, '').replace(TEMPLATE_PATTERN, '').trim();
}