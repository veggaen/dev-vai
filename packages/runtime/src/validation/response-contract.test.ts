import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertResponseContract } from './response-contract.js';

describe('assertResponseContract', () => {
  const schema = z.object({ id: z.string() }).strict();
  it('returns validated output', () => expect(assertResponseContract(schema, { id: 'ok' }, 'test')).toEqual({ id: 'ok' }));
  it('fails closed with boundary details', () => expect(() => assertResponseContract(schema, { id: 2 }, 'test')).toThrow('test'));
});
