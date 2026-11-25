import { describe, expect, it } from "vite-plus/test";

import {
  COMPANION_NAVIGATE_MESSAGE,
  COMPANION_PAIRING_RETRY_MS,
  machinesToPair,
  parseCompanionMachines,
  parseCompanionNavigateMessage,
} from "./companionMachines";

describe("machinesToPair", () => {
  const machines = parseCompanionMachines({
    machines: [
      { envId: "peter-mac", label: "Mac", online: true, environmentId: "env-mac" },
      { envId: "peter-pc", label: "PC", online: true, environmentId: "env-pc" },
      { envId: "peter-work", label: "Work", online: false, environmentId: "env-work" },
      { envId: "peter-new", label: "New", online: true, environmentId: null },
    ],
  });

  it("pairs only online machines that are not saved and whose id is known", () => {
    expect(
      machinesToPair({
        machines,
        savedEnvironmentIds: new Set(["env-mac"]),
        failedAtByEnvId: new Map(),
        now: 0,
      }).map((machine) => machine.envId),
    ).toEqual(["peter-pc"]);
  });

  it("waits after a failed pairing before trying that machine again", () => {
    const failedAtByEnvId = new Map([["peter-pc", 1_000]]);
    const pending = (now: number) =>
      machinesToPair({ machines, savedEnvironmentIds: new Set(), failedAtByEnvId, now }).map(
        (machine) => machine.envId,
      );
    expect(pending(1_000 + COMPANION_PAIRING_RETRY_MS - 1)).toEqual(["peter-mac"]);
    expect(pending(1_000 + COMPANION_PAIRING_RETRY_MS)).toEqual(["peter-mac", "peter-pc"]);
  });
});

describe("parseCompanionNavigateMessage", () => {
  it("opens in-app paths only", () => {
    const message = (path: unknown) => ({ type: COMPANION_NAVIGATE_MESSAGE, path });
    expect(parseCompanionNavigateMessage(message("/env-1/thread-1"))).toBe("/env-1/thread-1");
    expect(parseCompanionNavigateMessage(message("//evil.example/x"))).toBeNull();
    expect(parseCompanionNavigateMessage(message("https://evil.example"))).toBeNull();
    expect(parseCompanionNavigateMessage(message("/\\evil.example"))).toBeNull();
    expect(parseCompanionNavigateMessage({ type: "other", path: "/" })).toBeNull();
  });
});
