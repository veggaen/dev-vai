import { describe, expect, it } from 'vitest';
import { GrokFriendClient } from '../src/grok-friend/client.js';

describe('GrokFriendClient', () => {
  it('runs one bounded read-only collaborator turn and returns attributed evidence', async () => {
    let receivedCommand = '';
    let receivedArgs: string[] = [];
    const client = new GrokFriendClient({
      cwd: 'C:\\workspace',
      runner: async (command, args, options) => {
        receivedCommand = command;
        receivedArgs = args;
        expect(options).toEqual({
          cwd: 'C:\\workspace',
          timeoutMs: 90_000,
        });
        return {
          stdout: 'One grounded critique.\n',
          stderr: '',
        };
      },
    });

    const result = await client.ask('Review this bridge; echo SHOULD_NOT_EXECUTE.');

    expect(receivedCommand).toBe('grok');
    expect(receivedArgs).toContain('--max-turns');
    expect(receivedArgs).toContain('1');
    expect(receivedArgs).toContain('--no-plan');
    expect(receivedArgs).toContain('--no-subagents');
    // Grok friend-channel now allows full tools/web/etc (per user request for integrated high-intel advisor).
    // We no longer force --tools none or --disable-web-search.
    expect(receivedArgs.filter((arg) => arg.includes('SHOULD_NOT_EXECUTE'))).toHaveLength(1);
    expect(receivedArgs.join('\n')).toMatch(/Review this bridge; echo SHOULD_NOT_EXECUTE\./i);
    expect(result).toMatchObject({
      source: 'grok-cli-friend-channel',
      response: 'One grounded critique.',
    });
    expect(result.requestId).toBeTruthy();
    expect(Date.parse(result.capturedAt)).not.toBeNaN();
  });

  it('rejects an empty prompt before invoking the command', async () => {
    const client = new GrokFriendClient({
      runner: async () => {
        throw new Error('should not run');
      },
    });

    await expect(client.ask('   ')).rejects.toThrow(/prompt is empty/i);
  });
});
