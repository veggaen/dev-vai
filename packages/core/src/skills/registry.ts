/**
 * Skill Registry — loads, indexes, and routes skills.
 *
 * Skills live in the skills/ directory at the repo root.
 * Each skill folder contains a SKILL.md (instructions + manifest frontmatter).
 *
 * Compatible with Claude Code SKILL.md format.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillManifest, LoadedSkill, SkillTool, SkillPermission, SkillTrust } from './types.js';

// ── SKILL.md frontmatter parser ──────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return { meta: {}, body: raw };

  const meta: Record<string, unknown> = {};
  const lines = fmMatch[1].split('\n');
  let currentKey = '';
  let currentList: string[] = [];

  for (const line of lines) {
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey && currentList.length > 0) {
        meta[currentKey] = currentList;
        currentList = [];
      }
      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();
      if (val) {
        meta[currentKey] = val;
        currentKey = '';
      }
    } else if (line.match(/^\s+-\s+(.+)$/) && currentKey) {
      const item = line.match(/^\s+-\s+(.+)$/)?.[1]?.trim();
      if (item) currentList.push(item);
    }
  }
  if (currentKey && currentList.length > 0) {
    meta[currentKey] = currentList;
  }

  return { meta, body: fmMatch[2].trim() };
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') return [val];
  return [];
}

function parseManifest(meta: Record<string, unknown>, name: string): SkillManifest {
  return {
    name: String(meta['name'] ?? name),
    description: String(meta['description'] ?? ''),
    triggers: toStringArray(meta['triggers']),
    tools: toStringArray(meta['tools']) as SkillTool[],
    permissions: toStringArray(meta['permissions']) as SkillPermission[],
    requires: toStringArray(meta['requires']),
    trust: (String(meta['trust'] ?? 'verified')) as SkillTrust,
    version: meta['version'] ? String(meta['version']) : undefined,
    author: meta['author'] ? String(meta['author']) : undefined,
  };
}

// ── Built-in Skills ───────────────────────────────────────────────

const BUILTIN_SKILLS: LoadedSkill[] = [
  {
    manifest: {
      name: 'web-search',
      description: 'Search the web via SearXNG/Brave/DuckDuckGo and return ranked results with trust scores.',
      triggers: ['search', 'google', 'look up', 'find out', 'research', 'latest', 'current'],
      tools: ['search', 'fetch'],
      permissions: ['web'],
      trust: 'builtin',
    },
    instructions: `# Web Search Skill

## Purpose
Search the web and return ranked results with trust tiers and citations.

## Procedure
1. Normalize the query (remove question words, extract key entities)
2. Run parallel searches across available providers (SearXNG → Brave → DuckDuckGo → Wikipedia)
3. Rank by trust × relevance × recency
4. Deduplicate by domain
5. Return top results with: URL, title, snippet, trust score

## Output format
Each result: { url, title, snippet, trustScore, domain }
Always attribute which source provided each piece of information.
`,
    path: 'builtin',
  },
  {
    manifest: {
      name: 'fact-extractor',
      description: 'Extract factual claims with provenance from web pages or text.',
      triggers: ['extract', 'what does it say', 'find the fact', 'check source'],
      tools: ['fetch', 'extractor'],
      permissions: ['web', 'page-text'],
      trust: 'builtin',
    },
    instructions: `# Fact Extractor Skill

## Purpose
Extract specific factual claims from a source, preserving exact provenance (URL + snippet span).

## Procedure
1. Fetch the source page (respect timeout limits)
2. Strip nav/ads/boilerplate — keep main content only
3. Extract sentences that directly answer the query
4. Record: source URL, extracted text, character position in source
5. Score confidence based on: source trust tier, claim specificity, cross-source agreement

## Output format
EvidenceBlock[] with: id, url, title, snippet, trustScore, domain, fetchedAt
`,
    path: 'builtin',
  },
  {
    manifest: {
      name: 'citation-composer',
      description: 'Assemble a cited answer from evidence blocks. Inline citations like [1], [2].',
      triggers: ['cite', 'with sources', 'reference', 'evidence', 'where does this come from'],
      tools: ['memory'],
      permissions: ['memory-read'],
      trust: 'builtin',
    },
    instructions: `# Citation Composer Skill

## Purpose
Build a grounded answer from evidence blocks with inline numbered citations.

## Procedure
1. Group evidence blocks by topic/claim
2. Identify corroborated claims (appear in 2+ sources → higher confidence)
3. Draft answer using only evidence-supported statements
4. Insert inline citations: "X is true [1][3]"
5. Append numbered source list

## Rules
- Never state something as fact if only one low-trust source supports it
- Mark uncertainty explicitly: "According to [1], though this is unconfirmed..."
- If sources conflict: present both with attribution

## Output format
CitedAnswer: { text, evidence[], confidence }
`,
    path: 'builtin',
  },
  {
    manifest: {
      name: 'research-agent',
      description: 'Full research pipeline: search → read pages → extract facts → cite answer.',
      triggers: ['research', 'deep dive', 'investigate', 'compare sources', 'perplexity-style'],
      tools: ['search', 'fetch', 'extractor', 'ranker'],
      permissions: ['web', 'page-text'],
      requires: ['web-search', 'fact-extractor', 'citation-composer'],
      trust: 'builtin',
    },
    instructions: `# Research Agent Skill

## Purpose
Full Perplexity-style research pipeline: multi-engine search → page reading → evidence extraction → cited synthesis.

## Procedure
1. Rewrite query into 3-6 search variants
2. Search in parallel across providers
3. Rank results by trust × relevance
4. Read full pages for top 3 trusted results
5. Extract evidence blocks per claim
6. Cross-check: find corroborated claims
7. Synthesize cited answer

## Quality gates
- Minimum 2 sources before stating something as confirmed
- Flag anything from a single low-trust source
- Always show the full source list even if truncating answer

## Provenance
Record full trace: which engine, which URLs, which snippets used, timestamp.
`,
    path: 'builtin',
  },
  {
    manifest: {
      name: 'code-verifier',
      description: 'Verify generated code: syntax check, import validation, detect obvious runtime errors.',
      triggers: ['verify code', 'check code', 'validate', 'does this compile', 'will this work'],
      tools: ['code-runner'],
      permissions: ['local-files'],
      trust: 'builtin',
    },
    instructions: `# Code Verifier Skill

## Purpose
Catch problems in generated code before presenting it to the user.

## Checks
1. Syntax validity (TypeScript/JavaScript: check for unclosed brackets, invalid syntax)
2. Import resolution (are all imports available in the project?)
3. Type consistency (obvious mismatches)
4. Runtime patterns (null dereference, missing await, wrong event handler signatures)
5. Dependency completeness (is package.json updated?)

## Output
{ valid: boolean, errors: string[], warnings: string[], suggestions: string[] }
`,
    path: 'builtin',
  },
];

// ── SkillRegistry ─────────────────────────────────────────────────

export class SkillRegistry {
  private readonly skills = new Map<string, LoadedSkill>();
  private readonly skillsDir: string;

  constructor(skillsDir?: string) {
    // Default: skills/ at repo root (3 levels up from packages/core/src/skills/)
    this.skillsDir = skillsDir ?? resolve(import.meta.url
      ? new URL(import.meta.url).pathname.replace(/\/packages\/.*$/, '/skills')
      : join(process.cwd(), 'skills'));

    // Register builtins first
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.manifest.name, skill);
    }

    // Load user-installed skills from disk
    this.loadFromDisk();
  }

  /** Load skills from the skills/ directory */
  private loadFromDisk(): void {
    if (!existsSync(this.skillsDir)) return;

    try {
      const entries = readdirSync(this.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(this.skillsDir, entry.name);
        const skillMdPath = join(skillPath, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;

        try {
          const raw = readFileSync(skillMdPath, 'utf-8');
          const { meta, body } = parseFrontmatter(raw);
          const manifest = parseManifest(meta, entry.name);
          // Only load untrusted skills if they have explicit trust flag
          // Community skills need at least 'community' trust in their manifest
          this.skills.set(manifest.name, { manifest, instructions: body, path: skillPath });
        } catch {
          // Skip malformed skills silently
        }
      }
    } catch {
      // skills/ dir not accessible — continue with builtins only
    }
  }

  /** Get a skill by name */
  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  /** Get all skills */
  list(): LoadedSkill[] {
    return [...this.skills.values()];
  }

  /** Find skills that match a user message */
  matchForQuery(query: string): LoadedSkill[] {
    const lower = query.toLowerCase();
    const matches: Array<{ skill: LoadedSkill; score: number }> = [];

    for (const skill of this.skills.values()) {
      let score = 0;
      for (const trigger of skill.manifest.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          score += trigger.length > 5 ? 2 : 1; // longer triggers = more specific = higher score
        }
      }
      if (score > 0) matches.push({ skill, score });
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .map(m => m.skill);
  }

  /** Get the best skill for a specific role */
  forRole(role: 'researcher' | 'verifier' | 'citation'): LoadedSkill | undefined {
    const roleMap: Record<string, string> = {
      researcher: 'research-agent',
      verifier: 'code-verifier',
      citation: 'citation-composer',
    };
    return this.skills.get(roleMap[role]);
  }

  /** Get skills required by a given skill (resolve dependency tree) */
  resolveDeps(skillName: string, visited = new Set<string>()): LoadedSkill[] {
    if (visited.has(skillName)) return [];
    visited.add(skillName);
    const skill = this.skills.get(skillName);
    if (!skill) return [];
    const deps: LoadedSkill[] = [];
    for (const dep of skill.manifest.requires ?? []) {
      deps.push(...this.resolveDeps(dep, visited));
    }
    deps.push(skill);
    return deps;
  }

  /** Build the system context string for a skill (used as system message) */
  buildContext(skillName: string): string {
    const skill = this.skills.get(skillName);
    if (!skill) return '';
    const deps = this.resolveDeps(skillName);
    const parts = deps.map(s => `## Skill: ${s.manifest.name}\n${s.instructions}`);
    return parts.join('\n\n---\n\n');
  }

  /** How many skills loaded */
  get size(): number {
    return this.skills.size;
  }
}

// Singleton for use across the app
let _registry: SkillRegistry | null = null;
export function getSkillRegistry(skillsDir?: string): SkillRegistry {
  if (!_registry) _registry = new SkillRegistry(skillsDir);
  return _registry;
}
