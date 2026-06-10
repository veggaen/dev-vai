/** Stock "I don't know" / capabilities card the engine emits when it has no answer. */
export function isCapabilitiesFallbackResponse(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\bi don't have a confident answer\b/i.test(t)
    || /\bisn't in my knowledge yet\b/i.test(t)
    || /\bwhat i can do:\b/i.test(t)
    || /\bbuild me a next\.js app\b/i.test(t)
  );
}
