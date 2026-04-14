import {
  AnthropicAdapter,
  GoogleAdapter,
  LocalOpenAICompatibleAdapter,
  ModelRegistry,
  OpenAIAdapter,
  getProviderProfiles,
  type VaiConfig,
} from '@vai/core';

export function registerConfiguredModels(config: VaiConfig, models: ModelRegistry): string[] {
  const registered: string[] = [];

  if (config.providers.anthropic.enabled) {
    for (const profile of getProviderProfiles('anthropic')) {
      const adapter = new AnthropicAdapter(profile, config.providers.anthropic);
      models.register(adapter);
      registered.push(adapter.id);
    }
  }

  if (config.providers.openai.enabled) {
    for (const profile of getProviderProfiles('openai')) {
      const adapter = new OpenAIAdapter(profile, config.providers.openai);
      models.register(adapter);
      registered.push(adapter.id);
    }
  }

  if (config.providers.google.enabled) {
    for (const profile of getProviderProfiles('google')) {
      const adapter = new GoogleAdapter(profile, config.providers.google);
      models.register(adapter);
      registered.push(adapter.id);
    }
  }

  if (config.providers.local.enabled && config.providers.local.defaultModel) {
    const localModelName = config.providers.local.defaultModel;
    const adapter = new LocalOpenAICompatibleAdapter(
      {
        id: `local:${localModelName}`,
        provider: 'local',
        modelName: localModelName,
        displayName: `Local ${localModelName}`,
        description: 'Ollama-compatible local model endpoint',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: {
          streaming: false,
          toolUse: false,
          vision: false,
          extendedThinking: false,
          embeddings: false,
          structuredOutput: false,
          systemPrompts: true,
          multiTurn: true,
        },
        cost: { inputPer1M: 0, outputPer1M: 0 },
        speedTier: 'medium',
        qualityTier: 'local',
      },
      config.providers.local,
    );
    models.register(adapter);
    registered.push(adapter.id);
  }

  return registered;
}