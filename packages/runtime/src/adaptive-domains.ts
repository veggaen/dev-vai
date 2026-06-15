import { ThorsenAdaptiveController } from '@vai/core';

export function createRuntimeAdaptiveDomains() {
  const chat = new ThorsenAdaptiveController();
  const tools = new ThorsenAdaptiveController();

  return {
    chat,
    tools,
    snapshot: () => ({
      chat: chat.snapshot(),
      tools: tools.snapshot(),
    }),
  };
}
