// Central model registry. Model IDs and providers are configurable via settings.
// Never hard-codes model IDs deep in agent code.
import "server-only";
import { getSettings } from "./db";
import { getEnv, type EnvKey } from "./env";
import { getChain } from "./fallback-chain";
import type { ModelConfig } from "./types";

// Canonical registry — provider-level defaults. Specific model_id chosen per session.
const BASE_PROVIDERS: Record<
  ModelConfig["provider"],
  { base_url: string; keyEnv: EnvKey; note?: string }
> = {
  nvidia: {
    base_url: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    note: "OpenAI-compatible chat completions. Model must exist on NVIDIA.",
  },
  openrouter: {
    base_url: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    note: "OpenRouter aggregates many model vendors.",
  },
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    keyEnv: "GEMINI_API_KEY",
    note: "Google Gemini REST API. Use native generateContent for multimodal.",
  },
  minimax: {
    // NOTE: We do NOT invent a direct MiniMax endpoint. The provided key looks like a
    // NVIDIA-issued Bearer token (nvapi-... prefix), so we route MiniMax via NVIDIA
    // unless/until the user configures a real direct MiniMax endpoint.
    base_url: "",
    keyEnv: "MINIMAX_API_KEY",
    note:
      "Direct MiniMax endpoint NOT configured. Routing through NVIDIA/OpenRouter by default.",
  },
};

export function getBaseUrl(provider: ModelConfig["provider"]): string {
  return BASE_PROVIDERS[provider].base_url;
}
export function getKeyEnv(provider: ModelConfig["provider"]): EnvKey {
  return BASE_PROVIDERS[provider].keyEnv;
}
export function getProviderNote(provider: ModelConfig["provider"]): string {
  return BASE_PROVIDERS[provider].note ?? "";
}

export function providerConfigured(provider: ModelConfig["provider"]): boolean {
  return Boolean(getEnv(BASE_PROVIDERS[provider].keyEnv));
}

// Known multimodal-capable model substrings (for capability detection — user can override).
// "gemini-3.6-flash" matches the "gemini" / "gemini-3" hints, so the default
// vision model is correctly detected as image-capable.
const VISION_HINTS = [
  "vision",
  "phi-3-vision",
  "vision-instruct",
  "gemma-3",
  "qwen2-vl",
  "llama-3.2-11b-vision",
  "minimax-m3", // per NVIDIA docs, MiniMax M3 supports image input
  "gemini", // all modern Gemini models accept image input
  "gemini-3", // explicit: gemini-3.6-flash supports_image=true
  "gpt-4o",
  "gpt-4-vision",
  "claude-3",
  "llava",
  "qwen-vl",
  "pixtral",
  "florence",
];

function guessSupportsImage(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return VISION_HINTS.some((h) => m.includes(h));
}

function guessSupportsReasoning(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return ["reasoning", "o1", "r1", "deepseek-r", "gemini-2"].some((h) =>
    m.includes(h)
  );
}

export function buildConfig(
  provider: ModelConfig["provider"],
  model_id: string,
  role: string,
  priority: number
): ModelConfig {
  const base = BASE_PROVIDERS[provider];
  return {
    id: `${provider}:${model_id}`,
    provider,
    model_id,
    base_url: base.base_url,
    api_key_env: base.keyEnv,
    supports_image: guessSupportsImage(model_id),
    supports_reasoning: guessSupportsReasoning(model_id),
    supports_structured_output: true,
    enabled: Boolean(getEnv(base.keyEnv)),
    priority,
    role,
  };
}

/** Build the effective model set for a new analysis, using stored settings. */
export function buildEffectiveModels(): {
  vision: ModelConfig | null;
  text: ModelConfig;
  judge: ModelConfig;
  all: ModelConfig[];
} {
  const s = getSettings();
  const visionChoice = s.models.vision;
  // Keep this function primary-only for snapshot/UI backward compatibility.
  // Runtime role calls use getModelChain() for provider failover.
  const textChoice = s.models.text ?? {
    provider: "gemini",
    model_id: "gemini-3.6-flash",
  };
  const judgeChoice = s.models.judge ?? {
    provider: "gemini",
    model_id: "gemini-3.6-flash",
  };

  const vision: ModelConfig | null = visionChoice
    ? buildConfig(visionChoice.provider as ModelConfig["provider"], visionChoice.model_id, "vision", 1)
    : null;

  const text = buildConfig(
    textChoice.provider as ModelConfig["provider"],
    textChoice.model_id,
    "text",
    1
  );
  const judge = buildConfig(
    judgeChoice.provider as ModelConfig["provider"],
    judgeChoice.model_id,
    "judge",
    1
  );

  return {
    vision: vision?.enabled ? vision : null,
    text: text.enabled ? text : { ...text, enabled: false },
    judge: judge.enabled ? judge : { ...judge, enabled: false },
    all: [vision, text, judge].filter(Boolean) as ModelConfig[],
  };
}

/** Return the enabled, ordered failover chain for a role. */
export function getModelChain(role: "vision" | "text" | "judge"): ModelConfig[] {
  const settings = getSettings();
  return getChain(role, settings.models[role]);
}
