import { resolveCompanionOrigin } from "@t3tools/shared/companionSubscriptions";

/** A machine the Companion gateway lists for the signed-in account. */
export interface CompanionMachine {
  readonly envId: string;
  readonly label: string;
  readonly online: boolean;
  /** The machine's T3 environment id, or null while the gateway cannot reach it. */
  readonly environmentId: string | null;
}

/** A pairing attempt that failed waits this long before the next try. */
export const COMPANION_PAIRING_RETRY_MS = 5 * 60_000;

/** The Companion origin for this page, or null when the client runs without one. */
export function companionOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return resolveCompanionOrigin(
    window.location.origin,
    (import.meta.env.VITE_COMPANION_ORIGIN as string | undefined) ?? null,
  );
}

export function parseCompanionMachines(value: unknown): CompanionMachine[] {
  const machines = (value as { machines?: unknown } | null)?.machines;
  if (!Array.isArray(machines)) return [];
  return machines.flatMap((entry): CompanionMachine[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.envId !== "string" || record.envId.length === 0) return [];
    return [
      {
        envId: record.envId,
        label: typeof record.label === "string" && record.label ? record.label : record.envId,
        online: record.online === true,
        environmentId:
          typeof record.environmentId === "string" && record.environmentId
            ? record.environmentId
            : null,
      },
    ];
  });
}

/**
 * Online machines this client has not saved yet and has not failed to pair recently. A machine
 * whose environment id is unknown cannot be checked against the saved list, so it waits.
 */
export function machinesToPair(input: {
  readonly machines: ReadonlyArray<CompanionMachine>;
  readonly savedEnvironmentIds: ReadonlySet<string>;
  readonly failedAtByEnvId: ReadonlyMap<string, number>;
  readonly now: number;
}): CompanionMachine[] {
  return input.machines.filter((machine) => {
    if (!machine.online || machine.environmentId === null) return false;
    if (input.savedEnvironmentIds.has(machine.environmentId)) return false;
    const failedAt = input.failedAtByEnvId.get(machine.envId);
    return failedAt === undefined || input.now - failedAt >= COMPANION_PAIRING_RETRY_MS;
  });
}

export const COMPANION_NAVIGATE_MESSAGE = "t3-companion:navigate";

/** The in-app path a Companion page inside the Workbench asks to open, if the message is one. */
export function parseCompanionNavigateMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== COMPANION_NAVIGATE_MESSAGE || typeof record.path !== "string") return null;
  const path = record.path;
  // Only same-app paths: no scheme, no protocol-relative host, no backslash tricks.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  return path;
}
