import {
  AnthropicAdapter,
  GoogleAdapter,
  LocalOpenAICompatibleAdapter,
  ModelRegistry,
  OpenAIAdapter,
  buildDiscoveredModelProfile,
  discoverOllamaModels,
  getProviderProfiles,
  rankDiscoveredModels,
  type VaiConfig,
} from '@vai/core';

export interface RegisterConfiguredModelsResult {
  /** All adapter ids registered by this call. */
  readonly registered: string[];
  /**
   * Installed local model ids ranked best-first (auto-discovered from the
   * Ollama daemon). Empty when discovery failed or local is disabled — the
   * fallback chain is then left untouched.
   */
  readonly rankedLocalIds: string[];
}

export interface RegisterConfiguredModelsOptions {
  /** Injectable for tests — defaults to live Ollama discovery. */
  readonly discover?: typeof discoverOllamaModels;
}

export async function registerConfiguredModels(
  config: VaiConfig,
  models: ModelRegistry,
  options?: RegisterConfiguredModelsOptions,
): Promise<RegisterConfiguredModelsResult> {
  const registered: string[] = [];
  const rankedLocalIds: string[] = [];

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

  if (config.providers.local.enabled) {
    const baseUrl = config.providers.local.baseUrl ?? 'http://localhost:11434';
    const configuredModel = config.providers.local.defaultModel;
    const discovered = await (options?.discover ?? discoverOllamaModels)(baseUrl);

    if (discovered && discovered.length > 0) {
      // Future-proof path: register every installed chat-capable model with
      // its real context window + capabilities. Pull a new model, restart,
      // and it is registered — no config or code change required.
      for (const model of rankDiscoveredModels(discovered)) {
        const adapter = new LocalOpenAICompatibleAdapter(
          buildDiscoveredModelProfile(model),
          config.providers.local,
        );
        models.register(adapter);
        registered.push(adapter.id);
        rankedLocalIds.push(adapter.id);
      }
      if (configuredModel && !rankedLocalIds.includes(`local:${configuredModel}`)) {
        console.warn(
          `[VAI] LOCAL_MODEL=${configuredModel} is not installed in Ollama — run "ollama pull ${configuredModel}". `
          + `Using ${rankedLocalIds[0] ?? 'no local model'} for local escalation this session.`,
        );
      }
    } else if (configuredModel) {
      // Daemon unreachable at boot: keep the legacy static registration so the
      // configured model still works once Ollama comes up.
      const adapter = new LocalOpenAICompatibleAdapter(
        {
          id: `local:${configuredModel}`,
          provider: 'local',
          modelName: configuredModel,
          displayName: `Local ${configuredModel}`,
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
  }

  return { registered, rankedLocalIds };
}
