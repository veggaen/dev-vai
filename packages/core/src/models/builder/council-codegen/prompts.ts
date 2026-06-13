import type { BrandBlueprint } from './brand-blueprints.js';
import type { CouncilAppSpec, CouncilCodegenMessage, CouncilEditContext } from './types.js';

/**
 * Prompt builders for the council codegen pipeline. Kept small and literal:
 * local 7–8B models follow short, hard-edged contracts far better than long
 * persona prompts. Every prompt pins the output format because the pipeline
 * parses it mechanically.
 */

const APP_CONTRACT = [
  'Output EXACTLY one fenced code block and nothing else — no prose before or after:',
  '',
  '```tsx title="src/App.tsx"',
  '...the complete App component...',
  '```',
  '',
  'Hard rules for src/App.tsx:',
  '- Import ONLY from \'react\' (useState/useMemo/useEffect as needed). No other packages, no image files, no fetch/network. Do NOT import any CSS file — the scaffold loads it.',
  '- One component: `export default function App()`. Helper components may live in the same file above it.',
  '- Implement the requested features as WORKING interactions (state that changes when the user clicks/types), not static mockups.',
  '- Seed realistic mock data inline (5+ items where a list is involved) so the preview looks alive immediately.',
  '- Guard EVERY indexed access: `items[index]` can be undefined after the user advances past the end — check it (`const current = items[index]; if (!current) return <EmptyState/>;`) and render an explicit finished/empty state. A runtime crash on the last card is the #1 failure of this app class.',
  '- Use semantic HTML with accessible labels (aria-label on icon-only buttons, <label> on inputs).',
  '- TypeScript strict mode must pass: type the state, no `any`, no unused variables. Type record objects you index by string (e.g. `Record<string, number>`).',
  '- className discipline: use ONLY semantic kebab-case class names you invent (card-stack, action-row, like-button, match-overlay). A separate stylist will write CSS for EXACTLY the class names you use, so every visual element needs a meaningful class. NEVER use Tailwind/utility names (flex, p-4, bg-gray-900, absolute inset-0…) — they do not exist here and render as unstyled text.',
].join('\n');

const CLONE_FIDELITY_RULE = 'If the brief references a known product (Tinder, Twitter/X, Instagram, Spotify, Trello, Airbnb, …), mirror that product\'s signature experience and layout — e.g. Tinder → a swipeable profile-card deck with photo area, name+age, like/pass buttons and a match list; Trello → drag-style columns with cards. A generic dashboard or form is wrong for a clone request.';

const NO_EXTERNAL_ASSETS_RULE = 'All visuals must be self-contained: CSS gradients, inline SVG, or initials-on-gradient avatars. NEVER reference external URLs (no randomuser.me, no unsplash, no placekitten, no http(s) images) — the sandbox is offline and they render as broken images.';

function renderBlueprint(blueprint: BrandBlueprint): string {
  return [
    `BRAND BLUEPRINT — ${blueprint.brand} clone. Implement ALL of these signature features; the council reviewers reject builds that miss any:`,
    ...blueprint.features.map((f, i) => `${i + 1}. ${f}`),
    `Visual identity: ${blueprint.visual}`,
  ].join('\n');
}

export function buildArchitectMessages(brief: string, blueprint?: BrandBlueprint | null): readonly CouncilCodegenMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the architect on a small product council. Turn the user brief into a tight build spec for a single-page React app.',
        'Respond with ONLY a JSON object, no markdown fences, in this exact shape:',
        '{"title": "App Name", "packageName": "kebab-case-name", "summary": "one sentence", "features": ["feature 1", "feature 2", "feature 3", "feature 4"]}',
        blueprint
          ? 'Rules: 5-7 features. This is a CLONE brief — the features MUST cover every blueprint item below (compress wording, drop none).'
          : 'Rules: 3-6 features, each a concrete user-visible capability ("add and check off items", not "good UX").',
        blueprint ? renderBlueprint(blueprint) : CLONE_FIDELITY_RULE,
        'Stay inside what one React component with local state can do — no backend, no auth, no routing.',
      ].join('\n'),
    },
    { role: 'user', content: `Brief: ${brief}` },
  ];
}

export function buildCoderMessages(brief: string, spec: CouncilAppSpec, blueprint?: BrandBlueprint | null): readonly CouncilCodegenMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the coder on a small product council building a React + Vite + TypeScript app. The scaffold (package.json, index.html, main.tsx, tsconfig, styles.css) already exists — you write ONLY src/App.tsx.',
        blueprint ? renderBlueprint(blueprint) : CLONE_FIDELITY_RULE,
        NO_EXTERNAL_ASSETS_RULE,
        '',
        APP_CONTRACT,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Brief: ${brief}`,
        '',
        `App: ${spec.title} — ${spec.summary}`,
        'Features to implement:',
        ...spec.features.map((f, i) => `${i + 1}. ${f}`),
      ].join('\n'),
    },
  ];
}

/** Render current sandbox files for the edit prompt. */
function renderEditFiles(edit: CouncilEditContext): string {
  return edit.files.map((file) => [
    `FILE: ${file.path}`,
    '```',
    file.content,
    '```',
  ].join('\n')).join('\n\n');
}

export function buildEditMessages(brief: string, edit: CouncilEditContext): readonly CouncilCodegenMessage[] {
  return [
    {
      role: 'system',
      content: [
        `You are the coder on a small product council. The user has a RUNNING app ("${edit.projectName}") and is asking for a change to it. Apply the requested change to the CURRENT files — this is an edit, not a new app.`,
        '',
        'Hard rules:',
        `- Keep the app's identity: same product, same name, same purpose. Never rename it or replace it with a different app, and never turn the request's words into a new app title.`,
        '- Re-emit ONLY the files that must change, each as a COMPLETE file (no diffs, no "rest unchanged" comments) in its own fenced block with title="<path>", e.g.:',
        '',
        '```tsx title="src/App.tsx"',
        '...complete updated file...',
        '```',
        '',
        '- You may only touch the project source files shown below (typically src/App.tsx and src/styles.css). Do not emit package.json, index.html, main.tsx, or tsconfig.json.',
        "- Import ONLY from 'react'. TypeScript strict mode must pass.",
        '- Plain CSS only; style every class you use; keep the existing design language unless the request says otherwise; interactive elements keep :hover/:focus states.',
        '- If the change is purely visual (colors, background, typography), prefer changing ONLY src/styles.css.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Requested change: ${brief}`,
        '',
        'CURRENT PROJECT FILES:',
        renderEditFiles(edit),
      ].join('\n'),
    },
  ];
}

export function buildEditRepairMessages(
  brief: string,
  edit: CouncilEditContext,
  previousOutput: string,
  issues: readonly string[],
): readonly CouncilCodegenMessage[] {
  return [
    buildEditMessages(brief, edit)[0],
    {
      role: 'user',
      content: [
        `Requested change: ${brief}`,
        '',
        'Your previous edit had blocking problems. Fix every listed issue and re-emit the changed files completely (titled fenced blocks, complete file contents).',
        'Blocking issues:',
        ...issues.map((issue, i) => `${i + 1}. ${issue}`),
        '',
        'CURRENT PROJECT FILES:',
        renderEditFiles(edit),
        '',
        'YOUR PREVIOUS (REJECTED) EDIT:',
        previousOutput.slice(0, 9000),
      ].join('\n'),
    },
  ];
}

export function buildReviewerMessages(
  brief: string,
  spec: CouncilAppSpec,
  appTsx: string,
  blueprint?: BrandBlueprint | null,
): readonly CouncilCodegenMessage[] {
  // Cap the code shown to a reviewer — a 7B reviewer loses the plot beyond a
  // few thousand tokens, and truncation tails are flagged by validation anyway.
  const code = appTsx.length > 9000 ? `${appTsx.slice(0, 9000)}\n// …truncated for review…` : appTsx;
  return [
    {
      role: 'system',
      content: [
        'You are a code reviewer on a small product council. Review the App.tsx below against the brief.',
        'Respond with ONLY a JSON object, no markdown fences, in this exact shape:',
        '{"verdict": "ship" | "needs-work", "mustFix": ["blocking problem", ...], "notes": ["non-blocking suggestion", ...]}',
        'mustFix is ONLY for: a requested feature that is missing or non-functional, code that cannot compile, an interaction that cannot work, or an unguarded indexed access that will crash at runtime (e.g. `items[index].field` where index can pass the end of the array — the white-screen bug). Style opinions go in notes.',
        ...(blueprint
          ? [`This is a ${blueprint.brand} clone. Each missing item from this checklist is a must-fix: ${blueprint.reviewChecklist.join('; ')}.`]
          : []),
        'If the app honestly covers the brief, verdict is "ship" with an empty mustFix.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Brief: ${brief}`,
        `Features promised: ${spec.features.join('; ')}`,
        '',
        'src/App.tsx:',
        code,
      ].join('\n'),
    },
  ];
}

export function buildRepairMessages(
  brief: string,
  spec: CouncilAppSpec,
  previousAppTsx: string,
  issues: readonly string[],
  blueprint?: BrandBlueprint | null,
): readonly CouncilCodegenMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the coder on a small product council. Your previous src/App.tsx had blocking problems. Fix every listed issue and re-emit the COMPLETE file.',
        'Fix strategies: "Property X does not exist on type" → add X to the type/interface AND to every object you create of that type, or compute the value inline where it is used instead. "Cannot find name X" → declare it or fix the typo. Do not repeat the previous code unchanged.',
        ...(blueprint ? [renderBlueprint(blueprint), NO_EXTERNAL_ASSETS_RULE] : [NO_EXTERNAL_ASSETS_RULE]),
        '',
        APP_CONTRACT,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Brief: ${brief}`,
        `App: ${spec.title} — ${spec.summary}`,
        '',
        'Blocking issues to fix:',
        ...issues.map((issue, i) => `${i + 1}. ${issue}`),
        '',
        'Previous src/App.tsx:',
        '```tsx',
        previousAppTsx,
        '```',
      ].join('\n'),
    },
  ];
}

/**
 * Stylist stage — the inversion that kills the App↔CSS mismatch class: the
 * class list is EXTRACTED from the already-validated App.tsx and handed over
 * mechanically, so the stylesheet cannot target classes that don't exist and
 * App classes cannot go unstyled.
 */
export function buildStylistMessages(
  spec: CouncilAppSpec,
  classNames: readonly string[],
  appTsx: string,
  blueprint?: BrandBlueprint | null,
): readonly CouncilCodegenMessage[] {
  const structure = appTsx.length > 7000 ? `${appTsx.slice(0, 7000)}\n// …truncated…` : appTsx;
  return [
    {
      role: 'system',
      content: [
        `You are the stylist on a small product council. src/App.tsx is FINAL (shown below for structure). Write the complete stylesheet for it.`,
        'Output EXACTLY one fenced code block and nothing else:',
        '',
        '```css title="src/styles.css"',
        '...the complete stylesheet...',
        '```',
        '',
        'Hard rules:',
        '- Write a CSS rule for EVERY class in the CLASS LIST below — no class may be left unstyled, and do not invent rules for classes that are not in the list (plus body/element selectors as needed).',
        '- Plain CSS only: no Tailwind, no @import, no external URLs (offline sandbox).',
        '- A deliberate visual direction: styled page background, a set font-family, cohesive palette, consistent spacing, rounded corners and shadows where they fit.',
        '- :hover and :focus-visible states on every interactive class (buttons, cards, tabs, chips).',
        '- Responsive: @media for narrow screens.',
        ...(blueprint ? [`Visual identity to reproduce: ${blueprint.visual}`] : []),
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `App: ${spec.title} — ${spec.summary}`,
        '',
        `CLASS LIST (style every one): ${classNames.join(', ')}`,
        '',
        'src/App.tsx (final, for structure):',
        structure,
      ].join('\n'),
    },
  ];
}

export function buildStylistRepairMessages(
  spec: CouncilAppSpec,
  classNames: readonly string[],
  previousCss: string,
  issues: readonly string[],
  blueprint?: BrandBlueprint | null,
): readonly CouncilCodegenMessage[] {
  return [
    buildStylistMessages(spec, classNames, '', blueprint)[0],
    {
      role: 'user',
      content: [
        `App: ${spec.title}`,
        `CLASS LIST (style every one): ${classNames.join(', ')}`,
        '',
        'Your previous stylesheet had blocking problems. Fix every issue and re-emit the COMPLETE stylesheet:',
        ...issues.map((issue, i) => `${i + 1}. ${issue}`),
        '',
        'Previous src/styles.css:',
        '```css',
        previousCss,
        '```',
      ].join('\n'),
    },
  ];
}
