import { isBusinessOpportunityRequest } from '../models/web-conclude-policy.js';

/**
 * Business-opportunity direction — the shared, pure emitter.
 *
 * This was `VaiEngine.tryBusinessOpportunityDirection` (a private method that
 * used no instance state). It is lifted here verbatim so BOTH routers answer a
 * business-idea ask with the SAME text:
 *   - VaiEngine's `generateResponse` cascade (its legacy path), and
 *   - ChatService's scored registry (Slice 1 promotes it to a rankable handler).
 *
 * Keeping ONE implementation is the core of killing the ChatService/VaiEngine
 * divergence (Slice 4): a "Norway software business idea" prompt can no longer
 * get a different answer depending on which router reached it.
 *
 * Pure: input string → answer string (or null when it isn't a business-idea ask).
 * The gate `isBusinessOpportunityRequest` is the SAME one both routers already
 * import, so the routing decision was already shared; only the answer was not.
 */
export function tryBusinessOpportunityDirection(input: string): string | null {
  if (!isBusinessOpportunityRequest(input)) return null;

  const norway = /\b(?:norway|norwegian|norge)\b/i.test(input);
  const asksUniqueness = /\b(?:unique|generic|original|distinct|differentiator|defensible|moat|standout|ownable|uncommon)\b/i.test(input);

  const candidate = norway
    ? [
      '**Candidate idea:** build a "Norwegian operations copilot" for small regulated businesses that turns messy obligations into daily work: Altinn-style filings, HMS/internal-control checklists, GDPR routines, WCAG accessibility checks, invoice/document triage, and municipality-specific deadlines.',
      '',
      'The wedge is not "AI dashboard for businesses". The wedge is a narrow, Norwegian workflow layer that knows local terminology, public-sector portals, compliance rhythms, and the difference between advice, evidence, and a task that must be completed by a human.',
    ].join('\n')
    : [
      '**Candidate idea:** pick one painful repeated workflow for one narrow buyer, then build software that turns the workflow into a short operating loop with evidence, reminders, review, and action history.',
      '',
      'The wedge is not the broad category. The wedge is the buyer, the repeated pain, the data you can structure better than competitors, and the proof that the tool saves time or prevents mistakes.',
    ].join('\n');

  const uniqueness = asksUniqueness
    ? [
      '**How to tell if it is actually distinct:**',
      '',
      '1. **Specific buyer:** can you name the first 20 buyers without saying "everyone"?',
      '2. **Specific trigger:** is there a moment where they must use it, such as a filing date, audit, incident, tender, shift handoff, or customer request?',
      '3. **Specific data/workflow:** do you encode local forms, terminology, edge cases, templates, or integrations that a generic chatbot will not keep straight?',
      '4. **Switching proof:** would the user still keep it after the novelty fades because it stores history, evidence, approvals, or team habits?',
      '5. **Search test:** if five competitors say the same promise on their homepage, your idea is still generic. Your differentiator must survive being written as one plain sentence.',
      '',
      'A good one-sentence test: "For [narrow buyer], Vai handles [specific recurring job] using [local evidence/workflow] so they get [measurable result] without [current painful workaround]."',
    ].join('\n')
    : [
      '**Validation path:** interview 10 target buyers, collect their current checklist/spreadsheet/email flow, build the smallest tool that replaces one weekly pain, then measure saved minutes, avoided mistakes, and whether they ask for the second workflow.',
    ].join('\n');

  return `${candidate}\n\n${uniqueness}`;
}
