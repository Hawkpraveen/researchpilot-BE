import { defaultProviderSettings, providerConnectionTimeoutMs } from "../../config/providerSettings.js";
import { messages } from "../../config/messages.js";
import { providerSettingsRepository } from "../../repositories/settings/providerSettings.repository.js";
import type { ProviderSettingsScope } from "../../repositories/settings/providerSettings.repository.js";
import type { ProviderConfigInput } from "../../controllers/settings/settings.validation.js";
import { createAppError } from "../../utils/AppError.js";

export function toProviderSettingsView(config: Omit<ProviderConfigInput, "apiKey">) {
  // Explicit projection: never return persisted provider credentials to clients.
  return { mode: config.mode, provider: config.provider, endpoint: config.endpoint, model: config.model, apiKey: "" };
}

export function createProviderSettingsService(
  repository = providerSettingsRepository,
  fetchProvider: typeof fetch = fetch,
) {
  async function testSelectedConfig(config: ProviderConfigInput, includeModels: boolean) {
    try {
      const isOllama = config.provider === "ollama";
      const endpoint = config.endpoint.replace(/\/+$/, "");
      const versionedEndpoint = endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`;
      const url = isOllama ? `${endpoint}/api/tags` : `${versionedEndpoint}/models`;
      const headers: Record<string, string> = {};
      if (config.provider === "anthropic") {
        headers["x-api-key"] = config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }
      const response = await fetchProvider(url, {
        headers,
        signal: AbortSignal.timeout(providerConnectionTimeoutMs),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        const message = response.status === 401 || response.status === 403
          ? "The provider rejected this API key. Check the key and try again."
          : `The provider returned HTTP ${response.status}.`;
        return { connected: false, message, ...(includeModels ? { models: [] as string[] } : {}) };
      }
      const payload: unknown = await response.json();
      const entries = typeof payload === "object" && payload !== null
        ? (("models" in payload && Array.isArray(payload.models) ? payload.models : "data" in payload && Array.isArray(payload.data) ? payload.data : []) as unknown[])
        : [];
      const models = entries.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const name = "name" in entry && typeof entry.name === "string" ? entry.name : "id" in entry && typeof entry.id === "string" ? entry.id : null;
        return name ? [name] : [];
      });
      const modelIsAvailable = models.length === 0 || models.includes(config.model);
      const hasLocalModel = !isOllama || models.length > 0;
      const connected = modelIsAvailable && hasLocalModel;
      const message = isOllama && models.length === 0
        ? "Ollama is reachable, but no local models are installed yet."
        : !modelIsAvailable
          ? `The selected model was not listed. Choose one of the ${models.length} available models.`
          : models.length
            ? `Connected; ${models.length} models are available.`
            : "Connected to the provider; enter a model ID.";
      return { connected, message, ...(includeModels ? { models } : {}) };
    } catch {
      return {
        connected: false,
        message: config.provider === "ollama" ? messages.PROVIDER_CONNECTION_FAILED : "Could not reach the selected provider. Check its endpoint and try again.",
        ...(includeModels ? { models: [] as string[] } : {}),
      };
    }
  }

  return {
    async get(scope: ProviderSettingsScope) {
      const config = await repository.find(scope);
      return toProviderSettingsView(config ?? defaultProviderSettings);
    },
    async save(scope: ProviderSettingsScope, userId: string, input: ProviderConfigInput) {
      const config = await repository.save(scope, userId, input);
      if (!config) throw createAppError(500, "PROVIDER_SAVE_FAILED", messages.PROVIDER_SAVE_FAILED, true);
      return toProviderSettingsView(config);
    },
    async test(scope: ProviderSettingsScope, unsavedConfig?: ProviderConfigInput) {
      const savedConfig = await repository.find(scope);
      if (!unsavedConfig && !savedConfig) throw createAppError(404, "PROVIDER_NOT_CONFIGURED", messages.PROVIDER_NOT_CONFIGURED);
      if (!unsavedConfig && savedConfig && savedConfig.mode !== "local") {
        return { connected: true, message: `${savedConfig.provider} configuration is saved; no changes need to be saved before testing.` };
      }
      let config: ProviderConfigInput;
      if (unsavedConfig) {
        const canReuseSavedKey = savedConfig
          && savedConfig.provider === unsavedConfig.provider
          && savedConfig?.endpoint.replace(/\/+$/, "") === unsavedConfig.endpoint.replace(/\/+$/, "");
        config = {
          ...unsavedConfig,
          apiKey: unsavedConfig.apiKey || (canReuseSavedKey ? savedConfig?.api_key ?? "" : ""),
        };
        if (config.provider !== "ollama" && !config.apiKey) {
          return { connected: false, message: "Enter the provider API key to test this unsaved configuration.", models: [] };
        }
      }
      else {
        if (!savedConfig) throw createAppError(404, "PROVIDER_NOT_CONFIGURED", messages.PROVIDER_NOT_CONFIGURED);
        config = { ...defaultProviderSettings, ...savedConfig, apiKey: savedConfig.api_key ?? "" } as ProviderConfigInput;
      }
      return testSelectedConfig(config, Boolean(unsavedConfig));
    },
  };
}

export const providerSettingsService = createProviderSettingsService();
