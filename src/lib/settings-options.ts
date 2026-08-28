// Pure helpers for the Settings page provider dropdowns.
// Kept in a standalone module (a Next.js page file may only export page fields,
// and this also makes the logic unit-testable).

export type Avail = Record<string, boolean>;

export const PROVIDERS = ["nvidia", "openrouter", "gemini", "minimax"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface ProviderOption {
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * Build the <option> list for a provider dropdown.
 * A provider is SELECTABLE when its API key is configured (avail[p] === true);
 * otherwise it is disabled and labeled "(no key)". The empty placeholder
 * renders as the slot-level "(disabled)" state when no provider is set.
 */
export function buildProviderOptions(
  avail: Avail,
  current: string | null | undefined
): ProviderOption[] {
  const options: ProviderOption[] = [
    { value: "", label: "(disabled)", disabled: true },
  ];
  for (const p of PROVIDERS) {
    const configured = avail[p] === true;
    options.push({
      value: p,
      label: configured ? p : `${p} (no key)`,
      disabled: !configured,
    });
  }
  return options;
}

/** Normalize an arbitrary JSON value into a safe availability map. */
export function normalizeAvail(raw: unknown): Avail {
  if (!raw || typeof raw !== "object") return {};
  const out: Avail = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = v === true;
  }
  return out;
}
