import { detectVenuePracticalDetail } from '../venue-practical-detail.js';

export function tryEmitBoundaryResponse(input: { content: string }): string | null {
  const text = input.content.trim();
  if (!text) return null;

  // NOTE: acute medical-emergency handling (chest pain + shortness of breath)
  // moved upstream into `security-review.ts` as a high-severity safety
  // incident, so it runs ahead of every router. Keep this handler focused on
  // ordinary topical boundaries (legal disputes, local providers, hardware).

  // Only treat this as a legal-dispute question when there's an actual dispute
  // signal — not just the bare word "agreement". Otherwise "what was the Paris
  // Agreement?" (a historical treaty) misroutes to contract-dispute advice.
  const mentionsLegal = /\b(?:contract|agreement|enforceable|legally|liable|lawsuit|sue|small\s+claims|terms\s+of\s+service)\b/i.test(text);
  const hasDispute = /\b(?:refus\w*|owe[ds]?|unpaid|won'?t\s+pay|doesn'?t\s+pay|breach\w*|enforce\w*|dispute|sue|lawsuit|terminat\w*|my\s+rights|liable|liability|small\s+claims|demand\s+letter)\b/i.test(text);
  const isDefinitional = /^\s*(?:what|who|when|which|where)\b/i.test(text)
    && !/\b(?:should\s+i|can\s+i|do\s+i|are\s+my\s+rights|can\s+i\s+do)\b/i.test(text);
  if (mentionsLegal && hasDispute && !isDefinitional) {
    return [
      'It depends on the contract terms and jurisdiction, so treat this as issue-spotting, not legal advice.',
      '',
      'Check first:',
      '1. Whether the contract clearly defines payment amount, due date, deliverables, and acceptance criteria.',
      '2. Whether you have proof of delivery, approval, messages, invoices, and reminders.',
      '3. Whether there is a dispute process, late-fee clause, venue/jurisdiction clause, or termination clause.',
      '4. Whether local consumer/business law overrides anything in the agreement.',
      '',
      'Practical next step: collect the signed contract, invoice trail, delivery evidence, and customer messages, then ask a lawyer in the relevant jurisdiction or send a formal demand letter if appropriate.',
    ].join('\n');
  }

  // A named venue + mutable practical detail is no longer an ungrounded local
  // recommendation: SearchPipeline can resolve the branch and verify the
  // requested fact from live first-party evidence. Let those turns reach the
  // research route instead of issuing this legacy blanket refusal.
  const venuePracticalDetail = detectVenuePracticalDetail(text);
  if (
    venuePracticalDetail === null
    && /\b(?:best|find|near me|nearby|open now|right now)\b[\s\S]{0,80}\b(?:plumber|electrician|restaurant|doctor|dentist|vet|mechanic)\b/i.test(text)
  ) {
    return [
      "I don't have live local listings or your exact location, so I should not invent a specific provider.",
      '',
      'Fastest way to get a good result:',
      '1. Check Google Maps or a local directory for your city and filter by open now / emergency if needed.',
      '2. Compare recent reviews, not just star average; look for mentions of punctuality, pricing, and follow-up.',
      '3. Call 2-3 options and ask for availability, call-out fee, hourly rate, and whether they handle your exact issue.',
      '4. For urgent water/electrical problems, choose availability and license/insurance over cheapest price.',
      '',
      'If you tell me the city, urgency, and exact issue, I can help you write the call/message and a checklist of what to ask.',
    ].join('\n');
  }

  if (/\b(?:laptop|computer|notebook)\b[\s\S]{0,120}\b(?:buy|under\s+\$?\d+|budget|school|coding)\b/i.test(text)) {
    return [
      'For coding and school under that budget, prioritize 16 GB RAM, a 512 GB SSD, a comfortable keyboard, good battery life, and a decent 14-15 inch screen over flashy specs.',
      '',
      'Good target spec:',
      '- CPU: recent Ryzen 5/7 or Intel Core i5/i7 U/P-series.',
      '- Memory: 16 GB RAM if possible; avoid 8 GB unless it is very cheap and upgradeable.',
      '- Storage: 512 GB SSD minimum.',
      '- Display: 1080p or better IPS/OLED; avoid dim low-quality panels.',
      '- Battery/keyboard: more important than a small CPU bump for school use.',
      '',
      'Shortlist categories to compare: Lenovo IdeaPad/ThinkPad E, ASUS Zenbook/Vivobook, Acer Swift, HP Pavilion/Envy, or a used/refurbished MacBook Air M1/M2 if the price is right. Verify current prices and return policy before buying.',
    ].join('\n');
  }

  return null;
}
