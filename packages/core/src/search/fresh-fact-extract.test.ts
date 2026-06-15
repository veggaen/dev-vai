import { describe, it, expect } from 'vitest';
import {
  extractFreshFact,
  extractFreshFactsForEntities,
  extractFreshFactSubjects,
  classifyFreshFactKind,
  type ReadSource,
} from './fresh-fact-extract.js';

function src(index: number, text: string, title = 'Source', url = 'https://example.com'): ReadSource {
  return { index, title, url, text };
}

describe('classifyFreshFactKind', () => {
  it('recognizes the fact kind a question asks for', () => {
    expect(classifyFreshFactKind('what is the price of btc')).toBe('price');
    expect(classifyFreshFactKind('weather in Oslo today')).toBe('temperature');
    expect(classifyFreshFactKind('latest version of node')).toBe('version');
    expect(classifyFreshFactKind('when was TypeScript released')).toBe('date');
    expect(classifyFreshFactKind('how many planets')).toBe('number');
    expect(classifyFreshFactKind('tell me a joke')).toBeNull();
  });
});

describe('extractFreshFact — price (the BTC failure case)', () => {
  // Realistic read-page content like the Binance/Google pages in the screenshot.
  const sources = [
    src(0, 'Bitcoin Price Today. The live price of Bitcoin is $65,706 USD with a 24-hour trading volume. Bitcoin is up 1.76% today.', 'Bitcoin Price Today', 'https://binance.com/btc'),
    src(1, 'Ethereum Price Today. 1 ETH = USD 1,719.7. Ethereum is currently priced at around $1,720 USD.', 'Ethereum Price', 'https://binance.com/eth'),
  ];

  it('pulls the BTC price line from read content', () => {
    const fact = extractFreshFact('what is the price of btc', sources, 'price');
    expect(fact).not.toBeNull();
    expect(fact!.text).toMatch(/\$65,706|65,706 USD/);
    expect(fact!.kind).toBe('price');
    expect(fact!.sourceIndex).toBe(0);
  });

  it('pulls the ETH price for an ETH ask', () => {
    const fact = extractFreshFact('eth price', sources, 'price');
    expect(fact).not.toBeNull();
    expect(fact!.text).toMatch(/1,719\.7|\$1,720/);
    expect(fact!.sourceIndex).toBe(1);
  });

  it('picks the PRICE line over a market-cap line (the ETH $1.3T bug)', () => {
    const mixed = [
      src(0, 'Ethereum market cap is $1,318,970,239,036 today. The price of Ethereum is currently $1,763.94 USD.', 'Ethereum', 'https://x.com/eth'),
    ];
    const fact = extractFreshFact('price of eth', mixed, 'price');
    expect(fact).not.toBeNull();
    expect(fact!.text).toMatch(/1,763\.94/);
    expect(fact!.text).not.toMatch(/1,318,970,239,036/);
  });

  it('does NOT fabricate when no source has a price', () => {
    const noPriceSources = [src(0, 'Bitcoin is a decentralized digital currency with no central authority.')];
    expect(extractFreshFact('what is the price of btc', noPriceSources, 'price')).toBeNull();
  });

  it('requires the line to be about the asked subject', () => {
    // A price figure that is NOT about the subject (gold, not btc) should not be returned for btc.
    const wrongSubject = [src(0, 'The price of gold is $2,300 per ounce today.')];
    expect(extractFreshFact('what is the price of btc', wrongSubject, 'price')).toBeNull();
  });
});

describe('extractFreshFactSubjects — split a multi-entity question (the "both" case)', () => {
  it('pulls distinct subjects from "price of eth and btc"', () => {
    expect(extractFreshFactSubjects('price of eth and btc tell me price of both please')).toEqual(['eth', 'btc']);
  });
  it('handles comma + vs + weather phrasing', () => {
    expect(extractFreshFactSubjects('weather in Oslo and Bergen')).toEqual(['oslo', 'bergen']);
    expect(extractFreshFactSubjects('btc vs eth price')).toContain('btc');
  });
  it('returns [] for a single-subject question', () => {
    expect(extractFreshFactSubjects('what is the price of btc')).toEqual([]);
  });
});

describe('extractFreshFactsForEntities — multi-entity ("btc AND eth")', () => {
  const sources = [
    src(0, 'Bitcoin (BTC) is currently trading at approximately $65,700 USD.'),
    src(1, 'Ethereum (ETH) is priced at around $1,720 USD.'),
  ];

  it('extracts one price per named entity', () => {
    const results = extractFreshFactsForEntities(['bitcoin', 'ethereum'], sources, 'price');
    expect(results).toHaveLength(2);
    expect(results[0].entity).toBe('bitcoin');
    expect(results[0].fact?.text).toMatch(/65,700/);
    expect(results[1].entity).toBe('ethereum');
    expect(results[1].fact?.text).toMatch(/1,720/);
  });

  it('returns null for an entity with no matching fact (no fabrication)', () => {
    const results = extractFreshFactsForEntities(['bitcoin', 'dogecoin'], sources, 'price');
    expect(results[0].fact).not.toBeNull();
    expect(results[1].fact).toBeNull(); // no dogecoin price in the sources
  });
});

describe('extractFreshFact — other fact kinds (scalable, not crypto-specific)', () => {
  it('extracts a version number', () => {
    const sources = [src(0, 'The latest version of Node.js is v22.19.0, released recently.')];
    const fact = extractFreshFact('latest version of node', sources, 'version');
    expect(fact?.text).toMatch(/22\.19\.0/);
  });

  it('extracts a temperature', () => {
    const sources = [src(0, 'The weather in Oslo today is 14°C and partly cloudy.')];
    const fact = extractFreshFact('weather in oslo', sources, 'temperature');
    expect(fact?.text).toMatch(/14\s?°C/);
  });
});
