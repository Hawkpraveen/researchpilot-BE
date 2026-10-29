export const defaultProviderSettings = {
  mode: "local",
  provider: "ollama",
  endpoint: "http://localhost:11434",
  model: "llama3.1",
  apiKey: "",
} as const;

export const providerConnectionTimeoutMs = 5_000;
