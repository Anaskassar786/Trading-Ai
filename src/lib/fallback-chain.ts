// Ordered, server-only model fallback chains. API keys are never exposed to callers.
import "server-only";
import { buildConfig } from "./model-registry";
import type { ModelConfig } from "./types";

export type FallbackProvider = ModelConfig["provider"];
export type FallbackEntry = {
  provider: FallbackProvider;
  model_id: string;
  supports_image?: boolean;
};

// These are intentionally availability-tolerant. Providers can add/remove free
// models; callLLM skips a 404 and continues down the chain.
export const VISION_CHAIN: readonly FallbackEntry[] = [
  { provider: "gemini", model_id: "gemini-3.6-flash", supports_image: true },
  { provider: "openrouter", model_id: "google/gemini-2.5-flash-preview", supports_image: true },
  { provider: "openrouter", model_id: "google/gemini-2.0-flash-exp:free", supports_image: true },
  { provider: "openrouter", model_id: "meta-llama/llama-3.2-11b-vision-instruct:free", supports_image: true },
  { provider: "nvidia", model_id: "microsoft/phi-3-vision-128k-instruct", supports_image: true },
  { provider: "nvidia", model_id: "google/gemma-3-4b-it", supports_image: true },
];

export const TEXT_CHAIN: readonly FallbackEntry[] = [
  { provider: "gemini", model_id: "gemini-3.6-flash" },
  { provider: "openrouter", model_id: "deepseek/deepseek-chat:free" },
  { provider: "openrouter", model_id: "meta-llama/llama-3.2-3b-instruct:free" },
  { provider: "openrouter", model_id: "qwen/qwen-2.5-7b-instruct:free" },
  { provider: "openrouter", model_id: "mistralai/mistral-nemo:free" },
  { provider: "nvidia", model_id: "meta/llama-3.1-8b-instruct" },
  { provider: "nvidia", model_id: "meta/llama-3.2-3b-instruct" },
  { provider: "nvidia", model_id: "mistralai/mistral-7b-instruct-v0.3" },
];

export const JUDGE_CHAIN: readonly FallbackEntry[] = [
  { provider: "gemini", model_id: "gemini-3.6-flash" },
  { provider: "openrouter", model_id: "deepseek/deepseek-r1:free" },
  { provider: "openrouter", model_id: "nvidia/llama-3.1-nemotron-70b-instruct:free" },
  { provider: "openrouter", model_id: "deepseek/deepseek-chat:free" },
  { provider: "nvidia", model_id: "nvidia/llama-3.1-nemotron-70b-instruct" },
  { provider: "nvidia", model_id: "meta/llama-3.1-8b-instruct" },
];

const ROLE_CHAINS: Record<"vision" | "text" | "judge", readonly FallbackEntry[]> = {
  vision: VISION_CHAIN,
  text: TEXT_CHAIN,
  judge: JUDGE_CHAIN,
};

function isProvider(value: string): value is FallbackProvider {
  return value === "gemini" || value === "openrouter" || value === "nvidia" || value === "minimax";
}

/**
 * Return enabled ModelConfigs in fallback order. A saved primary is put first
 * only when its provider key is configured; duplicate entries are removed.
 */
export function getChain(
  role: "vision" | "text" | "judge",
  userPrimary?: { provider: string; model_id: string } | null
): ModelConfig[] {
  const entries: FallbackEntry[] = [];
  if (
    userPrimary &&
    isProvider(userPrimary.provider) &&
    typeof userPrimary.model_id === "string" &&
    userPrimary.model_id.length > 0
  ) {
    entries.push({
      provider: userPrimary.provider,
      model_id: userPrimary.model_id,
    });
  }
  entries.push(...ROLE_CHAINS[role]);

  const seen = new Set<string>();
  const result: ModelConfig[] = [];
  for (const entry of entries) {
    const key = `${entry.provider}:${entry.model_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cfg = buildConfig(entry.provider, entry.model_id, role, result.length + 1);
    // The explicit capability annotation is useful for future chain entries;
    // the registry remains the source of truth for model capability guesses.
    if (entry.supports_image === true) cfg.supports_image = true;
    if (!cfg.enabled) continue;
    result.push(cfg);
  }
  return result;
}

