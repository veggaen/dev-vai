import { describe, expect, it } from 'vitest';
import type { Message } from './models/adapter.js';
import {
  answerMatchesVenuePracticalDetail,
  detectVenuePracticalDetail,
  extractVenueProximityRequest,
  extractVenuePracticalSubject,
  resolveVenuePracticalFollowUp,
} from './venue-practical-detail.js';

const priorPriceHistory: Message[] = [
  { role: 'user', content: 'hello, what is the price of visiting the snow park in oslo the snø and what are their prices?' },
  { role: 'assistant', content: 'Weekday and weekend ticket prices were listed.' },
];

describe('venue practical-detail intent', () => {
  it.each([
    ['what are their opening hours?', 'hours'],
    ['when do they open?', 'hours'],
    ['what time does it close today?', 'hours'],
    ['snow park schedule?', 'schedule'],
    ['show me the restaurant menu', 'menu'],
    ['how much is the food on their menu?', 'menu-price'],
    ['what does admission cost?', 'admission-price'],
    ['what is their phone number?', 'contact'],
    ['is there wheelchair access?', 'accessibility'],
  ] as const)('classifies %s as %s', (input, expected) => {
    expect(detectVenuePracticalDetail(input)).toBe(expected);
  });

  it.each([
    ['Store hours for Apple Fifth Avenue', 'hours'],
    ['Is the UNIQLO Ginza store open on Sunday?', 'hours'],
    ['What time does Harrods Knightsbridge shut tonight?', 'hours'],
    ['When is closing time at IKEA Shibuya?', 'hours'],
    ['Does Carrefour Champs-Élysées trade on Sundays?', 'hours'],
    ['Når stenger IKEA Furuset i dag?', 'hours'],
    ['¿A qué hora abre Zara Gran Vía?', 'hours'],
    ['À quelle heure ouvre Printemps Haussmann ?', 'hours'],
    ['Wann öffnet KaDeWe Berlin?', 'hours'],
    ['渋谷のユニクロは何時に開店しますか', 'hours'],
    ['上海优衣库营业时间', 'hours'],
    ['강남 나이키 매장 영업시간', 'hours'],
    ['what can I eat at Pret A Manger Heathrow Terminal 5?', 'menu'],
    ['show me the food list for Cedar House Auckland', 'menu'],
    ['what are the business hours for Sakura Pharmacy Kyoto?', 'hours'],
    ['how can I phone Northstar Books London?', 'contact'],
    ['how can I call the Samsung Experience Store Dubai Mall?', 'contact'],
    ['where can I find Nike Paris House of Innovation?', 'address'],
  ] as const)('classifies global-shop wording %s as %s', (input, expected) => {
    expect(detectVenuePracticalDetail(input)).toBe(expected);
  });

  it.each([
    ['Store hours for Apple Fifth Avenue', 'Apple Fifth Avenue'],
    ['Is the UNIQLO Ginza store open on Sunday?', 'UNIQLO Ginza store'],
    ['What time does Harrods Knightsbridge shut tonight?', 'Harrods Knightsbridge'],
    ['When is closing time at IKEA Shibuya?', 'IKEA Shibuya'],
    ['Når stenger IKEA Furuset i dag?', 'IKEA Furuset'],
    ['¿A qué hora abre Zara Gran Vía?', 'Zara Gran Vía'],
    ['À quelle heure ouvre Printemps Haussmann ?', 'Printemps Haussmann'],
    ['Wann öffnet KaDeWe Berlin?', 'KaDeWe Berlin'],
    ['渋谷のユニクロは何時に開店しますか', '渋谷のユニクロ'],
    ['上海优衣库营业时间', '上海优衣库'],
    ['강남 나이키 매장 영업시간', '강남 나이키 매장'],
  ])('keeps the branch identity for %s', (input, expected) => {
    expect(extractVenuePracticalSubject(input)).toBe(expected);
  });

  it('extracts only the prior venue identity, not its requested price shape', () => {
    const subject = extractVenuePracticalSubject(priorPriceHistory[0].content);
    expect(subject.toLowerCase()).toContain('snow park in oslo the snø');
    expect(subject.toLowerCase()).not.toMatch(/price|cost|ticket|admission/);
  });

  it('removes spoken open-up grammar while retaining business name and locality', () => {
    const subject = extractVenuePracticalSubject('when does the bakery on hommersåk open up? brygge bakeren');
    expect(subject.toLowerCase()).toContain('bakery on hommersåk');
    expect(subject.toLowerCase()).toContain('brygge bakeren');
    expect(subject.toLowerCase()).not.toMatch(/\b(?:when|does|open|up)\b/);
  });

  it.each([
    ["can you find meny of jønk' burgers closest to bygøy", "jønk' burgers", 'bygøy'],
    ['menu for the Jønk Burger nearest Bygdøy', 'Jønk Burger', 'Bygdøy'],
    ['what can I eat at the closest Jønk restaurant to Bygdøy?', 'Jønk restaurant', 'Bygdøy'],
    ['finn menyen til Jønk Burger nærmest Bygdøy', 'Jønk Burger', 'Bygdøy'],
    ['menú del McDonald’s más cerca de Plaza Mayor', 'McDonald’s', 'Plaza Mayor'],
    ['Speisekarte der IKEA-Filiale in der Nähe von Alexanderplatz', 'IKEA-Filiale', 'Alexanderplatz'],
    ['food list for Cedar House restaurant closest to Auckland Ferry Terminal', 'Cedar House restaurant', 'Auckland Ferry Terminal'],
    ['which branch of Northstar Books is nearest to Trafalgar Square', 'Northstar Books', 'Trafalgar Square'],
    ['opening hours for Sakura Pharmacy in de buurt van Amsterdam Centraal', 'Sakura Pharmacy', 'Amsterdam Centraal'],
    ['menu for Northstar Cafe n\u00e4ra Stockholm Central', 'Northstar Cafe', 'Stockholm Central'],
    ['what time does the Egon restaurant closest to Oslo Central Station open?', 'Egon restaurant', 'Oslo Central Station'],
    ['can you find the menu for the Egon restaurant nearest Oslo Central Station?', 'Egon restaurant', 'Oslo Central Station'],
  ])('separates nearest-branch wording in %s', (input, expectedVenue, expectedAnchor) => {
    expect(extractVenueProximityRequest(input)).toEqual({
      venue: expectedVenue,
      anchor: expectedAnchor,
    });
    expect(extractVenuePracticalSubject(input)).toBe(expectedVenue);
  });

  it.each([
    'what are their opening hours?',
    'when do they open?',
    'what time do they close?',
  ])('rewrites %s with entity-only history', (input) => {
    const rewritten = resolveVenuePracticalFollowUp(input, [
      ...priorPriceHistory,
      { role: 'user', content: input },
    ]);
    expect(rewritten?.toLowerCase()).toContain('snow park in oslo the snø');
    expect(rewritten?.toLowerCase()).toContain(input.replace(/[?]/g, '').toLowerCase());
    expect(rewritten?.toLowerCase()).not.toMatch(/price|cost|ticket|admission/);
  });

  it('requires clock-bearing opening-hour evidence and rejects duration prices', () => {
    expect(answerMatchesVenuePracticalDetail('hours', 'Monday–Friday: 10:00–17:00; Saturday: closed.')).toBe(true);
    expect(answerMatchesVenuePracticalDetail('hours', 'OUVERT de 10:00–20:00')).toBe(true);
    expect(answerMatchesVenuePracticalDetail('hours', 'Alle dager 10.30–20.00')).toBe(true);
    expect(answerMatchesVenuePracticalDetail('hours', 'Donnerstag, 01.01.')).toBe(false);
    expect(answerMatchesVenuePracticalDetail('hours', '2 hours, weekday from 395 kr.')).toBe(false);
  });

  it('keeps menu pricing distinct from admission pricing', () => {
    expect(answerMatchesVenuePracticalDetail('menu-price', 'Lunch menu: soup 145 kr and coffee 45 kr.')).toBe(true);
    expect(answerMatchesVenuePracticalDetail('menu-price', 'Admission ticket: 395 kr.')).toBe(false);
  });

  it('does not mistake a fact-shaped refusal for a verified menu answer', () => {
    expect(answerMatchesVenuePracticalDetail(
      'menu',
      "I found pages, but none of the sources exposed a current itemized menu. I won't substitute another branch.",
    )).toBe(false);
    expect(answerMatchesVenuePracticalDetail(
      'menu',
      'I searched for "Northstar menu" but did not find anything that matches. The results were off-topic.',
    )).toBe(false);
  });

  it('keeps a first-party contact fact when only the confidence note lacks corroboration', () => {
    expect(answerMatchesVenuePracticalDetail(
      'contact',
      'Phone: +44 20 7278 1661. Confidence: limited — I did not find a second source confirming the same claim.',
    )).toBe(true);
  });
});
