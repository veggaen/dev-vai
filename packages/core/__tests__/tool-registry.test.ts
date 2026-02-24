import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Tool, ToolContext, ToolResult } from '../src/tools/interface.js';

class FakeTool implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters = {};

  constructor(name: string) {
    this.name = name;
    this.description = `Fake tool: ${name}`;
  }

  async execute(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    return { success: true, output: 'ok' };
  }
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tool = new FakeTool('file_read');
    registry.register(tool);

    expect(registry.get('file_read')).toBe(tool);
    expect(registry.has('file_read')).toBe(true);
  });

  it('lists all tools', () => {
    const registry = new ToolRegistry();
    registry.register(new FakeTool('a'));
    registry.register(new FakeTool('b'));

    expect(registry.list()).toHaveLength(2);
  });

  it('throws when tool not found', () => {
    const registry = new ToolRegistry();
    expect(() => registry.get('nonexistent')).toThrow('Tool not found');
  });
});
