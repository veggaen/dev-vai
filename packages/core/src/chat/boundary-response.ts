export function tryEmitBoundaryResponse(input: { content: string }): string | null {
  const text = input.content.trim();
  if (!text) return null;

  if (/\b(?:crushing|severe|heavy)\s+chest\s+pain\b|\bchest\s+pain\b[\s\S]{0,80}\b(?:shortness of breath|can't breathe|cannot breathe|dizzy|sweating|left arm|jaw)\b/i.test(text)) {
    return [
      'Treat this as urgent: call emergency services now (112 in Norway/EU, 911 in the US) or have someone take you to emergency care immediately.',
      '',
      'Chest pain with shortness of breath can be a heart or lung emergency. Do not wait to see if it passes, do not drive yourself if you feel faint, and do not rely on chat advice for this.',
      '',
      'If you can, tell the dispatcher your age, symptoms, when it started, medications, and whether you have heart/lung history.',
    ].join('\n');
  }

  if (/\b(?:contract|agreement|customer refuses to pay|enforceable|legal)\b/i.test(text)) {
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

  if (/\b(?:best|find|near me|nearby|open now|right now)\b[\s\S]{0,80}\b(?:plumber|electrician|restaurant|doctor|dentist|vet|mechanic)\b/i.test(text)) {
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
