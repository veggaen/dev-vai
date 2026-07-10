const COLLAPSE_AFTER_CHARACTERS = 700;
const PREVIEW_CHARACTERS = 220;

export interface UserMessagePresentation {
  readonly collapsible: boolean;
  readonly text: string;
  readonly wordCount: number;
}

export function presentUserMessage(content: string, expanded: boolean): UserMessagePresentation {
  const clean = content.trim();
  const collapsible = clean.length > COLLAPSE_AFTER_CHARACTERS;
  const wordCount = clean ? clean.split(/\s+/).length : 0;
  if (!collapsible || expanded) return { collapsible, text: content, wordCount };

  const initial = clean.slice(0, PREVIEW_CHARACTERS);
  const lastBoundary = initial.lastIndexOf(' ');
  const preview = (lastBoundary > PREVIEW_CHARACTERS * 0.72 ? initial.slice(0, lastBoundary) : initial).trimEnd();
  return { collapsible, text: `${preview}…`, wordCount };
}
