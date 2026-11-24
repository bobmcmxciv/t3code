import { describe, expect, it } from "vite-plus/test";

import {
  companionRemainingPercent,
  filterCompanionSubscriptionsForOfficialUsage,
  formatCompanionResetCountdown,
  resolveCompanionSubscriptionsUrl,
  type CompanionSubscriptionCard,
} from "./companionSubscriptions.ts";

function card(
  provider: string,
  accountKey = "acc-1",
  overrides: Partial<CompanionSubscriptionCard> = {},
): CompanionSubscriptionCard {
  return {
    provider,
    accountKey,
    planName: null,
    balance: null,
    currency: null,
    windows: [],
    error: null,
    machines: ["host-1"],
    polledBy: "host-1",
    reportedAt: 1_795_540_000_000,
    ...overrides,
  };
}

describe("companionSubscriptions", () => {
  it("deduplicates providers already rendered natively by T3 official pools", () => {
    const cards = [
      card("anthropic", "user-a@example.com", { planName: "Claude Pro" }),
      card("openai-codex", "user-b@example.com", { planName: "ChatGPT Pro" }),
      card("xai-oauth", "user-c@example.com", { planName: "SuperGrok" }),
      card("antigravity", "default"),
      card("glm", "glm-acct-1", { planName: "max" }),
      card("deepseek", "ds-acct-1", { balance: -0.77, currency: "CNY" }),
      card("kimi", "kimi-acct-1", { error: "HTTP 401" }),
      card("devin", "user-d@example.com", { planName: "Devin Pro" }),
    ];

    const filtered = filterCompanionSubscriptionsForOfficialUsage(
      cards,
      new Set(["codex", "antigravity"]),
    );

    expect(filtered.map((item) => item.provider)).toEqual([
      "anthropic",
      "xai-oauth",
      "glm",
      "deepseek",
      "kimi",
      "devin",
    ]);
  });

  it("keeps codex and antigravity from Companion when native T3 pools have none", () => {
    const filtered = filterCompanionSubscriptionsForOfficialUsage(
      [card("openai-codex"), card("antigravity"), card("glm")],
      new Set(),
    );
    expect(filtered.map((item) => item.provider)).toEqual([
      "openai-codex",
      "antigravity",
      "glm",
    ]);
  });

  it("resolves same-origin URL on configured companion subdomains and falls back cleanly", () => {
    const configured = "https://t3.example.com";
    expect(resolveCompanionSubscriptionsUrl("https://node1.t3.example.com", configured)).toBe(
      "https://node1.t3.example.com/_portal/api/subscriptions",
    );
    expect(resolveCompanionSubscriptionsUrl("https://t3.example.com", configured)).toBe(
      "https://t3.example.com/_portal/api/subscriptions",
    );
    expect(resolveCompanionSubscriptionsUrl("http://127.0.0.1:3773", configured)).toBe(
      "https://t3.example.com/_portal/api/subscriptions",
    );
    expect(resolveCompanionSubscriptionsUrl(null, configured)).toBe(
      "https://t3.example.com/_portal/api/subscriptions",
    );
    expect(resolveCompanionSubscriptionsUrl("https://node1.t3.example.com", "")).toBe(
      "https://node1.t3.example.com/_portal/api/subscriptions",
    );
    expect(resolveCompanionSubscriptionsUrl("http://127.0.0.1:3773", "")).toBeNull();
    expect(resolveCompanionSubscriptionsUrl(null, "")).toBeNull();
  });

  it("computes remaining percent and countdown labels cleanly", () => {
    expect(companionRemainingPercent(59)).toBe(41);
    expect(companionRemainingPercent(0)).toBe(100);
    expect(companionRemainingPercent(115)).toBe(0);
    expect(companionRemainingPercent(null)).toBeNull();

    const now = 1_795_540_000_000;
    expect(formatCompanionResetCountdown(now + 45 * 60_000, now)).toBe("45m");
    expect(formatCompanionResetCountdown(now + (3 * 60 + 20) * 60_000, now)).toBe("3h 20m");
    expect(formatCompanionResetCountdown(now + (2 * 24 + 5) * 3600_000, now)).toBe("2d 5h");
    expect(formatCompanionResetCountdown(now - 1000, now)).toBeNull();
  });
});
