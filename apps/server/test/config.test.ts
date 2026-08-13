import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('server Eazo configuration', () => {
  it('keeps Eazo disabled when no credentials are configured', () => {
    const config = loadConfig({});
    expect(config.eazoAppAi).toBeUndefined();
    expect(config.analysisModels).toEqual([]);
    expect(config.modelChainTimeoutMs).toBe(60_000);
  });

  it('uses the competition model defaults only with complete credentials', () => {
    const config = loadConfig({
      EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
      EAZO_APP_ID: 'test-app',
      EAZO_PRIVATE_KEY: 'test-private-key'
    });

    expect(config.eazoAppAi).toEqual({
      apiBaseUrl: 'https://eazo.example/creator',
      appId: 'test-app',
      privateKey: 'test-private-key',
      textModelKey: 'deepseek.v3.2',
      visionModelKey: 'qwen.qwen3-vl-235b-a22b-instruct',
      maxRequestsPerMinute: 60,
      maxConcurrentRequests: 4,
      maxModelRequestsPerDay: 60
    });
  });

  it('accepts server-side text and vision model overrides and ignores other capabilities', () => {
    const config = loadConfig({
      EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
      EAZO_APP_ID: 'test-app',
      EAZO_PRIVATE_KEY: 'test-private-key',
      EAZO_AI_MODELS_JSON: JSON.stringify({
        text: 'zai.glm-5',
        vision: 'moonshotai.kimi-k2.5',
        image_generation: 'unused.image-model'
      })
    });

    expect(config.eazoAppAi).toMatchObject({
      textModelKey: 'zai.glm-5',
      visionModelKey: 'moonshotai.kimi-k2.5'
    });
    expect(config.eazoAppAi).not.toHaveProperty('image_generation');
  });

  it('allows the Railway-provided public hostname and bounded usage overrides', () => {
    const config = loadConfig({
      EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
      EAZO_APP_ID: 'test-app',
      EAZO_PRIVATE_KEY: 'test-private-key',
      EAZO_MAX_REQUESTS_PER_MINUTE: '30',
      EAZO_MAX_CONCURRENT_REQUESTS: '3',
      EAZO_MAX_MODEL_REQUESTS_PER_DAY: '45',
      RAILWAY_PUBLIC_DOMAIN: 'example.up.railway.app',
      MAX_TOTAL_UPLOAD_MB: '7'
    });

    expect(config.mcpAllowedHosts).toContain('example.up.railway.app');
    expect(config.maxTotalUploadBytes).toBe(7 * 1024 * 1024);
    expect(config.eazoAppAi).toMatchObject({
      maxRequestsPerMinute: 30,
      maxConcurrentRequests: 3,
      maxModelRequestsPerDay: 45
    });
    expect(config.remoteUsageLimits).toEqual({
      maxRequestsPerMinute: 30,
      maxConcurrentRequests: 3,
      maxModelRequestsPerDay: 45
    });
  });

  it('configures OpenAI-compatible text independently of vision and Eazo', () => {
    const config = loadConfig({
      MODEL_API_BASE_URL: 'https://models.example/v1',
      MODEL_API_KEY: 'server-only-key',
      TEXT_MODEL_NAME: 'deepseek-v3.2'
    });

    expect(config.text).toEqual({
      apiBaseUrl: 'https://models.example/v1',
      apiKey: 'server-only-key',
      modelName: 'deepseek-v3.2'
    });
    expect(config.vision).toBeUndefined();
    expect(config.eazoAppAi).toBeUndefined();
    expect(config.analysisModels).toEqual([
      {
        id: 'openai-compatible',
        label: '主办方模型',
        description: '使用比赛模型额度完成关系分析。',
        provider: 'openai-compatible',
        model: 'deepseek-v3.2'
      }
    ]);
  });

  it('accepts a strict server-only analysis model allowlist', () => {
    const config = loadConfig({
      MODEL_API_BASE_URL: 'https://models.example/v1',
      MODEL_API_KEY: 'server-only-key',
      TEXT_MODEL_NAME: 'default-model',
      EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
      EAZO_APP_ID: 'test-app',
      EAZO_PRIVATE_KEY: 'test-private-key',
      TEXT_MODEL_OPTIONS_JSON: JSON.stringify([
        {
          id: 'fast-model',
          label: '快速分析',
          description: '适合快速试用。',
          provider: 'openai-compatible',
          model: 'fast-upstream-model'
        },
        {
          id: 'warm-model',
          label: '温暖分析',
          description: '适合细致梳理。',
          provider: 'eazo',
          model: 'warm-upstream-model'
        }
      ])
    });

    expect(config.analysisModels).toEqual([
      {
        id: 'fast-model',
        label: '快速分析',
        description: '适合快速试用。',
        provider: 'openai-compatible',
        model: 'fast-upstream-model'
      },
      {
        id: 'warm-model',
        label: '温暖分析',
        description: '适合细致梳理。',
        provider: 'eazo',
        model: 'warm-upstream-model'
      }
    ]);
  });

  it('uses a model option as the model name when only generic credentials are set', () => {
    const config = loadConfig({
      MODEL_API_BASE_URL: 'https://models.example/v1',
      MODEL_API_KEY: 'server-only-key',
      TEXT_MODEL_OPTIONS_JSON: JSON.stringify([
        {
          id: 'option-only-model',
          label: '可选模型',
          description: '由白名单提供上游模型名。',
          provider: 'openai-compatible',
          model: 'upstream-model'
        }
      ])
    });

    expect(config.text).toBeUndefined();
    expect(config.modelApi).toEqual({
      apiBaseUrl: 'https://models.example/v1',
      apiKey: 'server-only-key'
    });
    expect(config.analysisModels?.[0]?.model).toBe('upstream-model');
  });

  it('rejects duplicate or reserved analysis model ids and unsafe metadata', () => {
    const credentials = {
      MODEL_API_BASE_URL: 'https://models.example/v1',
      MODEL_API_KEY: 'server-only-key',
      TEXT_MODEL_NAME: 'default-model'
    };
    const option = {
      id: 'first-model',
      label: '模型一',
      description: '第一项。',
      provider: 'openai-compatible',
      model: 'upstream-model'
    };

    expect(() =>
      loadConfig({
        ...credentials,
        TEXT_MODEL_OPTIONS_JSON: JSON.stringify([option, option])
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...credentials,
        TEXT_MODEL_OPTIONS_JSON: JSON.stringify([{ ...option, id: 'auto' }])
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...credentials,
        TEXT_MODEL_OPTIONS_JSON: JSON.stringify([{ ...option, label: 'bad\nlabel' }])
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...credentials,
        TEXT_MODEL_OPTIONS_JSON: JSON.stringify([{ ...option, extra: 'not-allowed' }])
      })
    ).toThrow('Invalid server environment configuration.');
  });

  it('rejects analysis options whose matching provider credentials are absent', () => {
    const genericOption = JSON.stringify([
      {
        id: 'generic-model',
        label: '主办方',
        description: '比赛额度。',
        provider: 'openai-compatible',
        model: 'upstream-model'
      }
    ]);
    const eazoOption = JSON.stringify([
      {
        id: 'eazo-model',
        label: 'Eazo',
        description: 'Eazo 额度。',
        provider: 'eazo',
        model: 'upstream-model'
      }
    ]);

    expect(() => loadConfig({ TEXT_MODEL_OPTIONS_JSON: genericOption })).toThrow(
      'Invalid server environment configuration.'
    );
    expect(() => loadConfig({ TEXT_MODEL_OPTIONS_JSON: eazoOption })).toThrow(
      'Invalid server environment configuration.'
    );
  });

  it('uses one OpenAI-compatible credential pair for independent text and vision models', () => {
    const config = loadConfig({
      MODEL_API_BASE_URL: 'https://models.example/v1',
      MODEL_API_KEY: 'server-only-key',
      TEXT_MODEL_NAME: 'text-model',
      VISION_MODEL_NAME: 'vision-model'
    });

    expect(config.text?.modelName).toBe('text-model');
    expect(config.vision?.modelName).toBe('vision-model');
  });

  it('prefers generic remote usage limits while retaining legacy Eazo limits', () => {
    const config = loadConfig({
      EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
      EAZO_APP_ID: 'test-app',
      EAZO_PRIVATE_KEY: 'test-private-key',
      EAZO_MAX_REQUESTS_PER_MINUTE: '20',
      EAZO_MAX_CONCURRENT_REQUESTS: '2',
      EAZO_MAX_MODEL_REQUESTS_PER_DAY: '25',
      MODEL_MAX_REQUESTS_PER_MINUTE: '31',
      MODEL_MAX_CONCURRENT_REQUESTS: '3',
      MODEL_MAX_REQUESTS_PER_DAY: '41',
      MODEL_CHAIN_TIMEOUT_MS: '12000'
    });

    expect(config.remoteUsageLimits).toEqual({
      maxRequestsPerMinute: 31,
      maxConcurrentRequests: 3,
      maxModelRequestsPerDay: 41
    });
    expect(config.modelChainTimeoutMs).toBe(12_000);
    expect(config.eazoAppAi).toMatchObject(config.remoteUsageLimits ?? {});
  });

  it('rejects partial credentials and invalid model JSON', () => {
    expect(() =>
      loadConfig({
        EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
        EAZO_APP_ID: 'test-app'
      })
    ).toThrow('Invalid server environment configuration.');

    expect(() =>
      loadConfig({
        EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
        EAZO_APP_ID: 'test-app',
        EAZO_PRIVATE_KEY: 'test-private-key',
        EAZO_AI_MODELS_JSON: 'not-json'
      })
    ).toThrow('Invalid server environment configuration.');

    expect(() =>
      loadConfig({
        MODEL_API_BASE_URL: 'https://models.example/v1',
        TEXT_MODEL_NAME: 'text-model'
      })
    ).toThrow('Invalid server environment configuration.');

    expect(() =>
      loadConfig({
        TEXT_MODEL_NAME: 'text-model'
      })
    ).toThrow('Invalid server environment configuration.');

    expect(() =>
      loadConfig({
        MODEL_CHAIN_TIMEOUT_MS: '60001'
      })
    ).toThrow('Invalid server environment configuration.');
  });
});

describe('server realtime voice configuration', () => {
  const enabledVoiceEnvironment = {
    VOICE_ENABLED: 'true',
    OPENAI_REALTIME_API_KEY: 'server-only-realtime-key',
    VOICE_CONTEXT_SIGNING_SECRET: 'test-signing-secret-at-least-32-characters'
  } as const;

  it('keeps realtime voice disabled unless the explicit flag is enabled', () => {
    expect(
      loadConfig({
        OPENAI_REALTIME_API_KEY: 'unused-key',
        VOICE_CONTEXT_SIGNING_SECRET: 'unused-short-secret'
      }).realtimeVoice
    ).toBeUndefined();
  });

  it('loads official defaults and bounded single-instance limits', () => {
    const config = loadConfig(enabledVoiceEnvironment);

    expect(config.realtimeVoice).toEqual({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'server-only-realtime-key',
      model: 'gpt-realtime-2.1-mini',
      voice: 'marin',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      maxSessionSeconds: 300,
      maxActiveLeasesPerInstance: 2,
      maxSessionStartsPerDay: 30,
      contextSigningSecret: 'test-signing-secret-at-least-32-characters'
    });
  });

  it('normalizes the official OpenAI base and accepts bounded overrides', () => {
    const config = loadConfig({
      ...enabledVoiceEnvironment,
      OPENAI_REALTIME_API_BASE: 'https://api.openai.com/v1/',
      OPENAI_REALTIME_MODEL: 'realtime-model',
      OPENAI_REALTIME_VOICE: 'voice-name',
      OPENAI_REALTIME_TRANSCRIPTION_MODEL: 'transcribe-model',
      VOICE_SESSION_MAX_SECONDS: '180',
      VOICE_MAX_ACTIVE_LEASES_PER_INSTANCE: '3',
      VOICE_MAX_SESSION_STARTS_PER_DAY: '12'
    });

    expect(config.realtimeVoice).toMatchObject({
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'realtime-model',
      voice: 'voice-name',
      transcriptionModel: 'transcribe-model',
      maxSessionSeconds: 180,
      maxActiveLeasesPerInstance: 3,
      maxSessionStartsPerDay: 12
    });
  });

  it('rejects missing secrets, insecure endpoints, control characters, and excess duration', () => {
    expect(() => loadConfig({ VOICE_ENABLED: 'true' })).toThrow(
      'Invalid server environment configuration.'
    );
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        VOICE_CONTEXT_SIGNING_SECRET: 'too-short'
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        OPENAI_REALTIME_API_BASE: 'https://realtime.example/v1'
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        OPENAI_REALTIME_API_BASE: 'http://api.openai.com/v1'
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        OPENAI_REALTIME_API_BASE: 'https://user:password@api.openai.com/v1'
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        OPENAI_REALTIME_API_KEY: 'unsafe\nkey'
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        OPENAI_REALTIME_MODEL: 'unsafe model name'
      })
    ).toThrow('Invalid server environment configuration.');
    expect(() =>
      loadConfig({
        ...enabledVoiceEnvironment,
        VOICE_SESSION_MAX_SECONDS: '301'
      })
    ).toThrow('Invalid server environment configuration.');
  });
});
