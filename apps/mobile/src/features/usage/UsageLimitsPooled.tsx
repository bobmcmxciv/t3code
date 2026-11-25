import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  collectHttpQuotaSources,
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  paceRemainingPercent,
  remainingPercent,
  type LimitAccount,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import {
  companionBrandFor,
  companionRemainingPercent,
  filterCompanionSubscriptionsForOfficialUsage,
  formatCompanionResetCountdown,
  resolveCompanionSubscriptionsUrl,
  type CompanionSubscriptionCard,
} from "@t3tools/shared/companionSubscriptions";
import {
  collectExternalUsageLinks,
  collectLimitNotices,
  cursorUsageWindowDetails,
} from "@t3tools/shared/usageLimitsCopy";
import { msg, T, useGT, useMessages, Var } from "gt-react-native";
import { Fragment, type ReactNode, useEffect, useId, useState } from "react";
import { Pressable, View } from "react-native";
import { useNowMinuteMs } from "../../lib/clock";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Defs, Path, Pattern, Rect, Svg } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import type { MessageResolver } from "../../i18n/messages";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { environmentPresentations } from "../../state/presentation";
import { refillLabel, ResetCredits, resetLabels } from "./UsageLimitsSection";
import { usageProviderKind, useProviderColors } from "./usageProviders";

const PACE_LABEL = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
} as const;

function accountName(account: LimitAccount, resolve: MessageResolver) {
  if (account.displayName) return account.displayName;
  if (!account.email) return providerClients.get(account.driver)?.label ?? account.driver;
  return (
    emailInitials(account.email) || resolve(msg("Account", { $context: "fallback account name" }))
  );
}

function emailInitials(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase();
}

function accountHue(email: string) {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

// Same hashed hue as the web account chip, so an account keeps its color across clients.
function AccountChip({ email }: { readonly email: string }) {
  const hue = accountHue(email);
  return (
    <View
      className="size-5 items-center justify-center rounded-full"
      style={{ backgroundColor: `hsl(${hue}, 45%, 82%)` }}
    >
      <Text className="text-[9px] font-t3-bold" style={{ color: `hsl(${hue}, 45%, 28%)` }}>
        {emailInitials(email)}
      </Text>
    </View>
  );
}

// Same gap-and-tick as the Limits rows: two clipped copies of the segment leave a see-through gap.
function PaceGap({
  timeLeft,
  children,
}: {
  readonly timeLeft: number | null;
  readonly children: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const tickX =
    timeLeft === null || width < 6
      ? null
      : Math.min(Math.max((width * timeLeft) / 100, 3), width - 3);
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {tickX === null
        ? children
        : (
            [
              [0, tickX - 3],
              [tickX + 3, width],
            ] as const
          ).map(([start, end]) => (
            <View
              key={start}
              className="absolute top-0 bottom-0 overflow-hidden"
              style={{ left: start, width: end - start }}
            >
              <View className="absolute top-0 bottom-0" style={{ left: -start, width }}>
                {children}
              </View>
            </View>
          ))}
      {tickX !== null ? (
        <View
          className="absolute top-0.5 bottom-0.5 w-0.5 rounded-full bg-foreground"
          style={{ left: tickX - 1 }}
        />
      ) : null}
    </View>
  );
}

function AccountSegment({
  remaining,
  color,
  refillPercent,
}: {
  readonly remaining: number;
  readonly color: string;
  readonly refillPercent: number;
}) {
  const patternId = useId().replace(/:/g, "");
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
      }}
    >
      {size.width > 0 && size.height > 0 ? (
        // Numeric canvas dimensions clear Android SVG geometry cached before a segment resized.
        <Svg width={size.width} height={size.height} accessible={false}>
          <Defs>
            <Pattern id={patternId} width={6} height={6} patternUnits="userSpaceOnUse">
              <Path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke={color} strokeWidth={1} opacity={0.22} />
            </Pattern>
          </Defs>
          {refillPercent > 0 ? (
            <Rect
              x={`${100 - Math.min(100 - remaining, refillPercent)}%`}
              width={`${Math.min(100 - remaining, refillPercent)}%`}
              height="100%"
              fill={`url(#${patternId})`}
            />
          ) : null}
          <Rect width={`${remaining}%`} height="100%" fill={color} opacity={0.35} />
        </Svg>
      ) : null}
    </View>
  );
}

function PoolWindowRow({
  pool,
  color,
  now,
  environmentIds,
  label,
  description,
  wide,
  showTopDivider,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly environmentIds: readonly string[] | null;
  readonly label?: string | null;
  readonly description?: string;
  readonly wide: boolean;
  readonly showTopDivider: boolean;
}) {
  const navigation = useNavigation();
  const gt = useGT();
  const m = useMessages();
  const [barWidth, setBarWidth] = useState(0);
  const isSingleAccount = pool.columns.length === 1;
  const singleMember = isSingleAccount ? pool.columns[0] : undefined;
  const singleReset = singleMember?.window ? resetLabels(singleMember.window, now, m) : null;
  const singleCredits = singleMember?.account.limits.resetCredits?.availableCount ?? 0;
  const segmentWidth = barWidth / Math.max(pool.columns.length, 1);
  const inlineLabels = wide && !isSingleAccount && segmentWidth >= 96;
  const inlineReset = wide && !isSingleAccount && segmentWidth >= 150;
  const inlineName = wide && !isSingleAccount && segmentWidth >= 220;
  const nextRefill = pool.resets.find((reset) => reset.at > now && reset.restoresPercent > 0);
  const openAccount = (account: LimitAccount) =>
    navigation.navigate("SettingsUsageAccount", {
      accountKey: account.key,
      windowId: pool.id,
      windowKind: pool.kind,
      environmentIds,
    });

  const bar = (
    <View
      className="flex-row gap-1"
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
    >
      {pool.columns.map((member, index) => {
        if (!member.window)
          return (
            <View
              key={member.account.key}
              className={isSingleAccount ? "h-3 min-w-0 flex-1" : "h-6 min-w-0 flex-1"}
            />
          );
        const { account, window } = member;
        const timeLeft = paceRemainingPercent(window, now);
        const credits = account.limits.resetCredits?.availableCount ?? 0;
        const resetsIn = resetLabels(window, now, m)?.compact;
        return (
          <Pressable
            key={account.key}
            accessibilityRole="button"
            accessibilityLabel={
              timeLeft === null
                ? gt("Segment {index}, {account}, {remaining}% left", {
                    index: index + 1,
                    account: accountName(account, m),
                    remaining: remainingPercent(window),
                  })
                : gt(
                    "Segment {index}, {account}, {remaining}% left, {timeLeft}% of the window left",
                    {
                      index: index + 1,
                      account: accountName(account, m),
                      remaining: remainingPercent(window),
                      timeLeft,
                    },
                  )
            }
            accessibilityHint={gt("Show account details")}
            onPress={() => openAccount(account)}
            className={
              isSingleAccount
                ? "h-3 min-w-0 flex-1 rounded-full"
                : wide
                  ? "h-7 min-w-0 flex-1 rounded-md"
                  : "h-5.5 min-w-0 flex-1 rounded-md"
            }
          >
            <PaceGap timeLeft={timeLeft}>
              <View
                className={
                  isSingleAccount
                    ? "absolute inset-0 rounded-full bg-subtle"
                    : "absolute inset-0 rounded-md bg-subtle"
                }
              />
              <View
                className={
                  isSingleAccount
                    ? "absolute inset-0 overflow-hidden rounded-full"
                    : "absolute inset-0 overflow-hidden rounded-md"
                }
              >
                <AccountSegment
                  remaining={remainingPercent(window)}
                  color={normalizeProviderAccentColor(account.accentColor) ?? color}
                  refillPercent={window.resetsAt ? member.refillPercent : 0}
                />
              </View>
            </PaceGap>
            {isSingleAccount ? null : inlineLabels ? (
              <View
                pointerEvents="none"
                className="absolute inset-0 flex-row items-center justify-between gap-1.5 overflow-hidden rounded-md px-2"
              >
                <View className="min-w-0 shrink flex-row items-center gap-1">
                  {account.email ? <AccountChip email={account.email} /> : null}
                  {account.email && !(account.displayName && inlineName) ? null : (
                    <Text
                      numberOfLines={1}
                      className="min-w-0 shrink text-[11px] font-t3-medium text-foreground"
                    >
                      {accountName(account, m)}
                    </Text>
                  )}
                  <Text className="text-xs font-t3-bold tabular-nums text-foreground">
                    {remainingPercent(window)}%
                  </Text>
                </View>
                {inlineReset && (resetsIn || credits) ? (
                  <View className="shrink-0 flex-row items-center gap-1 rounded bg-grouped-card/85 px-1.5 py-0.5">
                    {resetsIn ? (
                      <Text className="text-[11px] tabular-nums text-foreground-muted">
                        {resetsIn}
                      </Text>
                    ) : null}
                    {credits ? (
                      <Text className="text-[11px] font-t3-medium tabular-nums text-foreground">
                        · {credits}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : (
              <View
                pointerEvents="none"
                className="absolute inset-0 items-center justify-center overflow-hidden rounded-md"
              >
                <Text
                  numberOfLines={1}
                  className="max-w-full shrink text-[11px] font-t3-semibold tabular-nums text-foreground"
                >
                  {index + 1}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );

  const legend =
    isSingleAccount || inlineLabels ? null : (
      <View className="mt-0.5 gap-0.5">
        {pool.columns.map(({ account, window }, index) => {
          if (!window) return null;
          const segmentColor = normalizeProviderAccentColor(account.accentColor) ?? color;
          const credits = account.limits.resetCredits?.availableCount ?? 0;
          const reset = resetLabels(window, now, m);
          const resetsIn = reset?.full;
          return (
            <Pressable
              key={account.key}
              accessibilityRole="button"
              accessibilityHint={gt("Show account details")}
              onPress={() => openAccount(account)}
              className="min-h-[30px] flex-row items-center gap-2 py-0.5 active:opacity-60"
            >
              <View className="relative size-4 items-center justify-center overflow-hidden rounded bg-subtle-strong">
                <View
                  pointerEvents="none"
                  className="absolute inset-0"
                  style={{ backgroundColor: segmentColor, opacity: 0.35 }}
                />
                <Text className="text-[10px] font-t3-semibold tabular-nums text-foreground">
                  {index + 1}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                className="min-w-0 flex-1 text-xs font-t3-medium text-foreground"
              >
                {accountName(account, m)}
              </Text>
              <Text className="text-xs font-t3-semibold tabular-nums text-foreground">
                {remainingPercent(window)}%
              </Text>
              <View className="flex-row items-center gap-1">
                {resetsIn ? (
                  <Text className="text-[11px] tabular-nums text-foreground-muted">
                    {reset?.compact}
                  </Text>
                ) : null}
                {credits ? (
                  <Text className="text-[11px] font-t3-medium tabular-nums text-foreground">
                    · 🎫{credits}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    );

  return (
    <View
      className={
        showTopDivider ? "gap-1.5 border-t border-border-subtle/70 pt-2" : "gap-1.5"
      }
    >
      <Pressable
        disabled={!singleMember}
        onPress={() => {
          if (singleMember) openAccount(singleMember.account);
        }}
        className="flex-row items-center justify-between gap-2 active:opacity-75"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
          {label !== null ? (
            <Text numberOfLines={1} className="shrink text-xs font-t3-medium text-foreground">
              {label ?? pool.label}
            </Text>
          ) : null}
          {pool.pace ? (
            <Text numberOfLines={1} className="text-[11px] text-foreground-tertiary">
              · {m(PACE_LABEL[pool.pace])}
            </Text>
          ) : null}
        </View>
        <View className="shrink-0 flex-row items-center gap-2">
          {isSingleAccount && singleReset?.compact ? (
            <View className="flex-row items-center gap-0.5">
              <SymbolView
                name="arrow.clockwise"
                size={10}
                tintColorClassName="accent-foreground-muted"
              />
              <Text className="text-[11px] tabular-nums text-foreground-muted">
                {singleReset.compact}
              </Text>
            </View>
          ) : !isSingleAccount && nextRefill ? (
            <Text className="text-[11px] tabular-nums text-foreground-muted">
              {refillLabel(nextRefill.member.window, now, nextRefill.restoresPercent, m)}
            </Text>
          ) : null}
          {isSingleAccount && singleCredits > 0 ? (
            <View className="flex-row items-center gap-0.5">
              <SymbolView name="ticket" size={11} tintColorClassName="accent-icon" />
              <Text className="text-[11px] font-t3-medium tabular-nums text-foreground">
                {singleCredits}
              </Text>
            </View>
          ) : null}
          <Text className="text-sm font-t3-bold tabular-nums text-foreground">
            {pool.remainingPercent}%
          </Text>
        </View>
      </Pressable>
      {bar}
      {description ? <Text className="text-[11px] text-foreground-muted">{description}</Text> : null}
      {legend}
    </View>
  );
}

function useMobileCompanionSubscriptions(): readonly CompanionSubscriptionCard[] {
  const [cards, setCards] = useState<readonly CompanionSubscriptionCard[]>([]);
  useEffect(() => {
    const url = resolveCompanionSubscriptionsUrl(
      null,
      process.env.EXPO_PUBLIC_COMPANION_ORIGIN ?? null,
    );
    if (!url) return;
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { subscriptions?: CompanionSubscriptionCard[] } | null) => {
        if (data && Array.isArray(data.subscriptions)) {
          setCards(data.subscriptions);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return cards;
}

function MobileCompanionSubscriptionCard({
  card,
  now,
}: {
  readonly card: CompanionSubscriptionCard;
  readonly now: number;
}) {
  const brand = companionBrandFor(card.provider);
  const currencyPrefix =
    card.currency === "CNY" ? "¥" : card.currency === "USD" ? "$" : card.currency ? `${card.currency} ` : "";
  const hasBalance = card.balance !== null && card.balance !== undefined && Number.isFinite(card.balance);
  const isLowBalance = hasBalance && (card.balance as number) <= 0;
  return (
    <View
      className="gap-2 rounded-2xl border border-border-subtle bg-grouped-card p-3"
      style={{ borderTopWidth: 2, borderTopColor: brand.color }}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <View
            className="size-5 items-center justify-center rounded-md"
            style={{ backgroundColor: `${brand.color}24`, borderWidth: 1, borderColor: `${brand.color}55` }}
          >
            <Text className="text-[9px] font-t3-bold" style={{ color: brand.color }}>
              {brand.shortCode}
            </Text>
          </View>
          <Text numberOfLines={1} className="text-sm font-t3-bold text-foreground">
            {brand.label}
          </Text>
          {card.planName ? (
            <Text numberOfLines={1} className="shrink text-[11px] text-foreground-muted">
              {card.planName}
            </Text>
          ) : null}
        </View>
        <View className="shrink-0 flex-row items-center gap-1.5">
          {card.machines.length > 1 ? (
            <View className="rounded-full bg-subtle px-2 py-0.5">
              <Text className="text-[10px] font-t3-medium tabular-nums text-foreground-muted">
                {card.machines.length} 机共用
              </Text>
            </View>
          ) : (
            <Text numberOfLines={1} className="text-[11px] text-foreground-tertiary">
              {card.polledBy}
            </Text>
          )}
        </View>
      </View>

      {hasBalance ? (
        <View className="flex-row items-center justify-between gap-2 pt-0.5">
          <Text className="text-xs text-foreground-muted">账户余额</Text>
          <Text
            className={
              isLowBalance
                ? "text-sm font-t3-bold tabular-nums text-destructive"
                : "text-sm font-t3-bold tabular-nums text-foreground"
            }
          >
            {currencyPrefix}
            {(card.balance as number).toFixed(2)}
            {isLowBalance ? " · 余额不足" : ""}
          </Text>
        </View>
      ) : null}

      {card.windows.map((win, index) => {
        const remaining = companionRemainingPercent(win.usedPercent);
        const resetsIn = formatCompanionResetCountdown(win.resetsAt, now);
        return (
          <View
            key={`${card.provider}:${win.key}:${index}`}
            className={
              index > 0 || hasBalance
                ? "gap-1.5 border-t border-border-subtle/70 pt-2"
                : "gap-1.5"
            }
          >
            <View className="flex-row items-center justify-between gap-2">
              <Text numberOfLines={1} className="min-w-0 flex-1 text-xs font-t3-medium text-foreground">
                {win.label}
              </Text>
              <View className="shrink-0 flex-row items-center gap-2">
                {resetsIn ? (
                  <Text className="text-[11px] tabular-nums text-foreground-muted">
                    ↻ {resetsIn}
                  </Text>
                ) : null}
                <Text className="text-sm font-t3-bold tabular-nums text-foreground">
                  {remaining !== null ? `${remaining}%` : "—"}
                </Text>
              </View>
            </View>
            <View className="h-3 w-full overflow-hidden rounded-full bg-subtle">
              {remaining !== null && remaining > 0 ? (
                <View
                  className="h-full rounded-full"
                  style={{ width: `${remaining}%`, backgroundColor: brand.color, opacity: 0.78 }}
                />
              ) : null}
            </View>
          </View>
        );
      })}

      {card.error && card.windows.length === 0 && !hasBalance ? (
        <Text className="text-[11px] text-warning-foreground">{card.error}</Text>
      ) : null}
    </View>
  );
}

export function UsageLimitsSection({
  now,
  failedLabels,
  selectedEnvironmentIds,
  wide = false,
}: {
  readonly now: number;
  readonly failedLabels: readonly string[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly wide?: boolean;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const selected =
    selectedEnvironmentIds === null
      ? presentations
      : new Map([...presentations].filter(([id]) => selectedEnvironmentIds.has(id)));
  const pools = collectLimitPools(collectLimitAccounts(selected), now);
  const companionSubscriptions = useMobileCompanionSubscriptions();
  const extraSubscriptions = filterCompanionSubscriptionsForOfficialUsage(
    companionSubscriptions,
    new Set(pools.map((pool) => String(pool.driver))),
  );
  const quotaSources = collectHttpQuotaSources(selected);
  const m = useMessages();
  const notices = collectLimitNotices(selected, m);
  const externalLinks = collectExternalUsageLinks(selected, m);
  const colors = useProviderColors();
  const gt = useGT();
  return (
    <View className="gap-3">
      {pools.length === 0 &&
      extraSubscriptions.length === 0 &&
      notices.length === 0 &&
      failedLabels.length === 0 &&
      externalLinks.length === 0 &&
      quotaSources.length === 0 ? (
        <Text className="py-10 text-center text-sm text-foreground-muted">
          {selected.size === 0
            ? gt("Select an environment to see limits.")
            : gt("No provider on the selected environments reports subscription limits.")}
        </Text>
      ) : null}
      {quotaSources.map((source) => (
        <View key={source.key} className="gap-3 rounded-[24px] bg-grouped-card p-4">
          <Text className="text-base font-t3-medium text-foreground">{source.label}</Text>
          {source.quotaAccounts?.map((account) => (
            <View key={account.id} className="gap-1">
              <Text className="text-sm font-t3-medium text-foreground">{account.label}</Text>
              {account.windows.map((window) => {
                const reset = resetLabels(window, now, m);
                return (
                  <View key={window.id} className="flex-row justify-between gap-3">
                    <Text className="shrink text-sm text-foreground-muted">{window.label}</Text>
                    <Text className="text-sm text-foreground-muted">
                      {gt("{remaining}% left", { remaining: remainingPercent(window) })}
                      {reset ? ` · ${reset.compact}` : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ))}
      {pools.map((pool) => {
        const windows = displayLimitWindows(pool);
        const sharedEnvLabels = [
          ...new Set(
            pool.accounts.flatMap((account) => account.environments.map((env) => env.label)),
          ),
        ];
        const primaryPlan =
          pool.accounts.length === 1 ? (pool.accounts[0]?.plan ?? null) : null;
        return (
          <Fragment key={pool.driver}>
            <View className="gap-2 rounded-2xl border border-border-subtle bg-grouped-card p-3">
              <View className="flex-row items-center justify-between gap-2">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                  <ProviderIcon provider={pool.driver} size={16} />
                  <Text numberOfLines={1} className="text-sm font-t3-bold text-foreground">
                    {providerClients.get(pool.driver)?.label ?? pool.driver}
                  </Text>
                  {primaryPlan ? (
                    <Text numberOfLines={1} className="shrink text-[11px] text-foreground-muted">
                      {primaryPlan}
                    </Text>
                  ) : null}
                </View>
                <View className="shrink-0 flex-row items-center gap-1.5">
                  {pool.accounts.length > 1 ? (
                    <View className="rounded-full bg-subtle px-2 py-0.5">
                      <Text className="text-[10px] font-t3-semibold tabular-nums text-foreground-secondary">
                        {pool.accounts.length} 账号
                      </Text>
                    </View>
                  ) : null}
                  {sharedEnvLabels.length > 1 ? (
                    <View className="rounded-full bg-subtle px-2 py-0.5">
                      <Text className="text-[10px] font-t3-medium tabular-nums text-foreground-muted">
                        {sharedEnvLabels.length} 机共用
                      </Text>
                    </View>
                  ) : sharedEnvLabels.length === 1 ? (
                    <Text numberOfLines={1} className="text-[11px] text-foreground-tertiary">
                      {sharedEnvLabels[0]}
                    </Text>
                  ) : null}
                </View>
              </View>
              {windows.map((window, index) => {
                const details =
                  pool.driver === "cursor"
                    ? cursorUsageWindowDetails(window.id, pool, m)
                    : undefined;
                return (
                  <PoolWindowRow
                    key={`${window.kind}:${window.id}`}
                    pool={window}
                    color={colors[usageProviderKind(pool.driver) ?? "codex"]}
                    now={now}
                    environmentIds={
                      selectedEnvironmentIds === null ? null : [...selectedEnvironmentIds]
                    }
                    label={details?.label}
                    description={details?.description}
                    wide={wide}
                    showTopDivider={index > 0}
                  />
                );
              })}
            </View>
          </Fragment>
        );
      })}
      {extraSubscriptions.map((card) => (
        <MobileCompanionSubscriptionCard
          key={`companion:${card.provider}:${card.accountKey}`}
          card={card}
          now={now}
        />
      ))}
      {externalLinks.map((link) => (
        <View key={link.url} className="gap-3 rounded-xl border border-border-subtle p-4">
          <Text className="text-base font-t3-medium text-foreground">{link.label}</Text>
          <Text className="text-xs text-foreground-muted">{link.accounts.join(", ")}</Text>
          {link.message ? (
            <Text className="text-sm text-foreground-muted">{link.message}</Text>
          ) : null}
          <Pressable
            accessibilityRole="link"
            className="min-h-11 justify-center"
            onPress={() => void tryOpenExternalUrl(link.url)}
          >
            <Text className="text-sm font-t3-medium text-primary">
              <T>Manage usage</T>
            </Text>
          </Pressable>
        </View>
      ))}
      {notices.length > 0 || failedLabels.length > 0 ? (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="flex-row items-start gap-2 rounded-xl border border-warning-border bg-warning px-3.5 py-3"
        >
          <SymbolView
            name="exclamationmark.triangle"
            size={16}
            tintColorClassName="accent-warning-foreground"
          />
          <View className="min-w-0 flex-1 gap-0.5">
            {notices.map((notice) => (
              <Text key={notice} className="text-sm font-t3-medium text-warning-foreground">
                {notice}
              </Text>
            ))}
            {failedLabels.length > 0 ? (
              <Text className="text-sm font-t3-medium text-warning-foreground">
                <T>
                  <Var>{failedLabels.join(", ")}</Var> could not refresh limits. Showing the last
                  known values.
                </T>
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

type AccountScreenProps = StaticScreenProps<{
  accountKey: string;
  windowId: string;
  windowKind: LimitPoolWindow["kind"];
  environmentIds: readonly string[] | null;
}>;

export function UsageLimitAccountScreen({ route }: AccountScreenProps) {
  const insets = useSafeAreaInsets();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const { accountKey, windowId, windowKind, environmentIds } = route.params;
  const now = useNowMinuteMs();
  const selectedIds =
    environmentIds === null ? null : new Set(environmentIds.map((id) => EnvironmentId.make(id)));
  const selected =
    selectedIds === null
      ? presentations
      : new Map([...presentations].filter(([id]) => selectedIds.has(id)));
  const accounts = collectLimitAccounts(selected);
  const account = accounts.find((candidate) => candidate.key === accountKey);
  const pool = collectLimitPools(accounts, now)
    .find((candidate) => candidate.driver === account?.driver)
    ?.windows.find((candidate) => candidate.id === windowId && candidate.kind === windowKind);
  const window = pool?.members.find((member) => member.account.key === accountKey)?.window;
  const evenPace = window ? paceRemainingPercent(window, now) : null;
  const reset = pool?.resets.find((candidate) => candidate.member.account.key === accountKey);
  const [revealed, setRevealed] = useState(false);
  const gt = useGT();
  return (
    <SettingsScreen title={gt("Account", { $context: "screen title" })}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {!account || !window ? (
          <Text className="text-base text-foreground-muted">
            <T>This account is no longer reporting limits on the selected environments.</T>
          </Text>
        ) : (
          <>
            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <ProviderIcon provider={account.driver} size={24} />
                <Text className="flex-1 text-xl font-t3-bold text-foreground">
                  {account.displayName ??
                    providerClients.get(account.driver)?.label ??
                    account.driver}
                </Text>
              </View>
              {account.email ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    revealed ? gt("Hide account email") : gt("Reveal account email")
                  }
                  onPress={() => setRevealed((value) => !value)}
                  className="min-h-[44px] justify-center"
                >
                  <Text className="text-sm text-foreground-muted">
                    {revealed ? account.email : "••••••@••••••"}
                  </Text>
                </Pressable>
              ) : null}
              {account.plan ? (
                <Text selectable className="text-sm text-foreground-muted">
                  {account.plan}
                </Text>
              ) : null}
            </View>
            <View className="gap-3 rounded-[24px] border-continuous bg-grouped-card p-4">
              <Text className="text-sm font-t3-medium text-foreground">{window.label}</Text>
              <Text className="text-3xl font-t3-bold tabular-nums text-foreground">
                <T>
                  <Var>{remainingPercent(window)}</Var>% left
                </T>
              </Text>
              {window.resetsAt ? (
                <Text selectable className="text-sm text-foreground-muted">
                  <T>
                    Resets{" "}
                    <Var>
                      {new Date(window.resetsAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </Var>
                  </T>
                </Text>
              ) : null}
              {evenPace !== null ? (
                <Text className="text-sm text-foreground-muted">
                  <T>
                    Even pace: <Var>{evenPace}</Var>% left by now
                  </T>
                </Text>
              ) : null}
              {reset && reset.restoresPercent > 0 ? (
                <Text className="text-sm text-foreground-muted">
                  <T>
                    Restores <Var>{reset.restoresPercent}</Var>% of the pool
                  </T>
                </Text>
              ) : null}
            </View>
            <View className="gap-2 rounded-[24px] border-continuous bg-grouped-card p-4">
              <Text className="text-sm font-t3-medium text-foreground">
                {account.environments.length
                  ? gt("Signed in", {
                      $context: "heading for environments signed in to the account",
                    })
                  : gt("Source", { $context: "heading for where account limits come from" })}
              </Text>
              {account.environments.length ? (
                account.environments.map((environment) => (
                  <Text key={environment.environmentId} className="text-sm text-foreground-muted">
                    {environment.label}
                  </Text>
                ))
              ) : (
                <Text className="text-sm text-foreground-muted">{account.sourceLabel}</Text>
              )}
            </View>
            {account.redeem && account.limits.resetCredits ? (
              <View className="gap-3 rounded-[24px] border-continuous bg-grouped-card p-4">
                <Text className="text-sm font-t3-medium text-foreground">
                  <T>Reset credits</T>
                </Text>
                <ResetCredits
                  key={account.key}
                  environmentId={account.redeem.environmentId}
                  input={account.redeem.input}
                  credits={account.limits.resetCredits}
                  now={now}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
