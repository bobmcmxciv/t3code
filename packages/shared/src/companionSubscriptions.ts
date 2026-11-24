export interface CompanionSubscriptionWindow {
  readonly key: string;
  readonly label: string;
  readonly usedPercent: number | null;
  readonly resetsAt: number | null;
  readonly status: string;
}

export interface CompanionSubscriptionCard {
  readonly provider: string;
  readonly accountKey: string;
  readonly planName?: string | null;
  readonly balance?: number | null;
  readonly currency?: string | null;
  readonly windows: readonly CompanionSubscriptionWindow[];
  readonly error?: string | null;
  readonly machines: readonly string[];
  readonly polledBy: string;
  readonly reportedAt?: number | null;
}

export interface CompanionBrandTheme {
  readonly label: string;
  readonly color: string;
  readonly shortCode: string;
  readonly nativeDriver?: string;
}

export const DEFAULT_COMPANION_PUBLIC_ORIGIN = "";

function normalizeOrigin(raw?: string | null): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]";
}

export const COMPANION_PROVIDER_BRANDS: Readonly<Record<string, CompanionBrandTheme>> = {
  anthropic: {
    label: "Claude",
    color: "#D97757",
    shortCode: "CL",
    nativeDriver: "claudeAgent",
  },
  "openai-codex": {
    label: "OpenAI Codex",
    color: "#10A37F",
    shortCode: "CX",
    nativeDriver: "codex",
  },
  "xai-oauth": {
    label: "SuperGrok",
    color: "#94A3B8",
    shortCode: "GK",
    nativeDriver: "grok",
  },
  antigravity: {
    label: "Antigravity",
    color: "#4285F4",
    shortCode: "AG",
    nativeDriver: "antigravity",
  },
  glm: {
    label: "智谱 GLM",
    color: "#6366F1",
    shortCode: "GL",
  },
  deepseek: {
    label: "DeepSeek",
    color: "#4D6BFE",
    shortCode: "DS",
  },
  kimi: {
    label: "Kimi Coding",
    color: "#0EA5E9",
    shortCode: "KM",
  },
  qwen: {
    label: "通义 Qwen",
    color: "#7C3AED",
    shortCode: "QW",
  },
  devin: {
    label: "Devin",
    color: "#14B8A6",
    shortCode: "DV",
  },
  cx2cc: {
    label: "CX2CC",
    color: "#F59E0B",
    shortCode: "C2",
  },
};

export function companionBrandFor(provider: string): CompanionBrandTheme {
  const key = provider.trim().toLowerCase();
  return (
    COMPANION_PROVIDER_BRANDS[key] ?? {
      label: provider,
      color: "#8B5CF6",
      shortCode: provider.slice(0, 2).toUpperCase() || "AI",
    }
  );
}

/**
 * Resolves the Companion subscriptions endpoint URL.
 * - When `configuredOrigin` is provided (e.g. via `VITE_COMPANION_ORIGIN` or
 *   `EXPO_PUBLIC_COMPANION_ORIGIN`), prefers same-origin `/_portal/api/subscriptions`
 *   if `currentOrigin` is on the same domain or a subdomain, otherwise uses `configuredOrigin`.
 * - When `configuredOrigin` is unset, falls back to same-origin `/_portal/api/subscriptions`
 *   on non-loopback web origins, and returns `null` on loopback/native origins so no request is sent.
 */
export function resolveCompanionSubscriptionsUrl(
  currentOrigin?: string | null,
  configuredOrigin?: string | null,
): string | null {
  const normalizedConfigured = normalizeOrigin(configuredOrigin ?? DEFAULT_COMPANION_PUBLIC_ORIGIN);
  const normalizedCurrent = normalizeOrigin(currentOrigin);

  if (normalizedCurrent && normalizedConfigured) {
    const currentHost = new URL(normalizedCurrent).hostname.toLowerCase();
    const configuredHost = new URL(normalizedConfigured).hostname.toLowerCase();
    if (currentHost === configuredHost || currentHost.endsWith(`.${configuredHost}`)) {
      return `${normalizedCurrent}/_portal/api/subscriptions`;
    }
  }

  if (normalizedConfigured) {
    return `${normalizedConfigured}/_portal/api/subscriptions`;
  }

  if (normalizedCurrent) {
    const currentHost = new URL(normalizedCurrent).hostname;
    if (!isLoopbackHost(currentHost)) {
      return `${normalizedCurrent}/_portal/api/subscriptions`;
    }
  }

  return null;
}

/**
 * Filters centralized Companion subscriptions so providers already rendered by T3's native
 * UsageLimits pools (e.g. codex, antigravity) are never duplicated, while bringing all other
 * imported subscriptions (Claude Pro, SuperGrok, Zhipu GLM, DeepSeek, Kimi, Devin, etc.)
 * seamlessly into T3's official Usage UI.
 */
export function filterCompanionSubscriptionsForOfficialUsage(
  cards: ReadonlyArray<CompanionSubscriptionCard>,
  existingNativeDrivers: ReadonlySet<string>,
): CompanionSubscriptionCard[] {
  const seenKeys = new Set<string>();
  const result: CompanionSubscriptionCard[] = [];
  for (const card of cards) {
    const provider = card.provider.trim().toLowerCase();
    if (!provider) continue;
    const brand = COMPANION_PROVIDER_BRANDS[provider];
    if (brand?.nativeDriver && existingNativeDrivers.has(brand.nativeDriver)) {
      continue;
    }
    const dedupeKey = `${provider}::${card.accountKey.trim().toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    result.push(card);
  }
  return result;
}

export function companionRemainingPercent(usedPercent: number | null): number | null {
  if (usedPercent === null || !Number.isFinite(usedPercent)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

export function formatCompanionResetCountdown(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null;
  const diffMs = resetsAt - now;
  if (diffMs <= 0) return null;
  const totalMins = Math.max(1, Math.round(diffMs / 60_000));
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
