import { describe, expect, it } from 'vitest';
import { WebSourceCapabilityLedger } from './web-source-capabilities.js';

describe('WebSourceCapabilityLedger', () => {
  it('learns a verified source capability only for the same venue and answer shape', () => {
    const ledger = new WebSourceCapabilityLedger();
    ledger.observeVerified({
      domain: 'order.example.com',
      capability: 'venue-menu',
      subject: 'Cedar House Burgers',
      url: 'https://order.example.com/merchant/cedar-house/menu',
    }, 100);

    expect(ledger.domainsFor('venue-menu', 'cedar house burgers')).toEqual(['order.example.com']);
    expect(ledger.domainsFor('venue-hours', 'cedar house burgers')).toEqual([]);
    expect(ledger.domainsFor('venue-menu', 'another restaurant')).toEqual([]);
    expect(ledger.confidence('order.example.com', 'venue-menu', 'Cedar House Burgers')).toBeCloseTo(0.6, 4);
  });

  it('round-trips a bounded, inspectable snapshot', () => {
    const ledger = new WebSourceCapabilityLedger();
    ledger.observeVerified({
      domain: 'shops.example.jp',
      capability: 'venue-locator',
      subject: 'Northstar Books',
      url: 'https://shops.example.jp/locations',
    }, 200);
    const restored = new WebSourceCapabilityLedger();
    restored.restore(ledger.serialize());

    expect(restored.size()).toBe(1);
    expect(restored.domainsFor('venue-locator', 'Northstar Books')).toEqual(['shops.example.jp']);
  });

  it('rejects observations whose URL belongs to another domain', () => {
    const ledger = new WebSourceCapabilityLedger();
    expect(ledger.observeVerified({
      domain: 'official.example',
      capability: 'venue-hours',
      subject: 'Example Shop',
      url: 'https://directory.example/example-shop',
    })).toBe(false);
    expect(ledger.size()).toBe(0);
  });
});
