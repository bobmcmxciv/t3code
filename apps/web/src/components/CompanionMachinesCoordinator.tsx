import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { companionOrigin, machinesToPair, parseCompanionMachines } from "../companionMachines";
import { environmentCatalog } from "../connection/catalog";
import { connectPairing } from "../connection/onboarding";
import { appAtomRegistry } from "../rpc/atomRegistry";

const SYNC_INTERVAL_MS = 60_000;

/**
 * Pairs every machine the signed-in Companion account owns, so one sidebar lists all of them as
 * the phone app does. Machines already saved are left alone; one that is offline pairs once it
 * comes back. Without a Companion session the gateway answers 401 and nothing happens.
 */
export function CompanionMachinesCoordinator() {
  const catalogReady = useAtomValue(environmentCatalog.catalogValueAtom).isReady;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the Companion gateway for machines to pair; the gateway is outside React state
  useEffect(() => {
    const origin = companionOrigin();
    if (!catalogReady || origin === null) return;
    const failedAtByEnvId = new Map<string, number>();
    let running = false;
    let stopped = false;
    const sync = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const listed = await fetch(`${origin}/_portal/api/machines`, { credentials: "include" });
        if (!listed.ok) return;
        const saved = new Set<string>(
          appAtomRegistry.get(environmentCatalog.catalogValueAtom).entries.keys(),
        );
        const pending = machinesToPair({
          machines: parseCompanionMachines(await listed.json()),
          savedEnvironmentIds: saved,
          failedAtByEnvId,
          now: Date.now(),
        });
        for (const machine of pending) {
          if (stopped) return;
          const minted = await fetch(`${origin}/_portal/api/machines/pair`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ envId: machine.envId }),
          });
          const body = minted.ok ? ((await minted.json()) as { pairingUrl?: unknown }) : null;
          if (typeof body?.pairingUrl !== "string") {
            failedAtByEnvId.set(machine.envId, Date.now());
            continue;
          }
          const result = await runAtomCommand(
            appAtomRegistry,
            connectPairing,
            {
              pairingUrl: body.pairingUrl,
              expectedEnvironmentId: machine.environmentId as EnvironmentId,
            },
            { label: connectPairing.label, reportFailure: false, reportDefect: true },
          );
          if (result._tag === "Failure") failedAtByEnvId.set(machine.envId, Date.now());
        }
      } catch {
        // The gateway or a machine is unreachable; the next tick tries again.
      } finally {
        running = false;
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [catalogReady]);
  return null;
}
