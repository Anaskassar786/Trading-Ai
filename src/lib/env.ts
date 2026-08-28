// Server-only access to environment variables. NEVER import from client components.
import "server-only";

export type EnvKey =
  | "NVIDIA_API_KEY"
  | "OPENROUTER_API_KEY"
  | "GEMINI_API_KEY"
  | "MINIMAX_API_KEY"
  | "TWELVE_DATA_API_KEY"
  | "FRED_API_KEY"
  | "NEWS_API_KEY";

export function getEnv(key: EnvKey): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

export function hasEnv(key: EnvKey): boolean {
  return Boolean(getEnv(key));
}

export function isTestMode(): boolean {
  return process.env.TEST_MODE === "1";
}
