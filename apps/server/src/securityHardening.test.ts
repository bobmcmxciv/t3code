// @effect-diagnostics nodeBuiltinImport:off
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "@effect/vitest";

import { cliReleaseDownloadBaseUrl, cliReleaseIndexPageUrl } from "@t3tools/shared/cliRelease";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { isRelayTracingEnabled } from "@t3tools/shared/otelEnvironment";
import { providerAuthReturnUrl } from "@t3tools/shared/providerAuthReturnUrl";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import {
  makeIsRepositoryStarred,
  makeStarRepository,
} from "@t3tools/source-control-github/server/driver";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "./config.ts";
import { resolveRelayClientTracingConfig } from "./cloud/publicConfig.ts";
import { claudeRuntimeQueryPolicyForRuntimePolicy } from "./orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ManagedPolicy from "./policy/ManagedPolicy.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import { getServerOwners, getTelemetryIdentity } from "./telemetry/Identify.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";

describe("self-hosted fork security and zero-telemetry hardening", () => {
  it("requires permission callback in Claude auto mode so escalated dangerous commands cannot be silently approved (Issue #15353)", () => {
    const policy = claudeRuntimeQueryPolicyForRuntimePolicy({
      runtimeMode: "auto",
      interactionMode: "default",
      cwd: null,
    });
    expect(policy.permissionMode).toBe("auto");
    expect(policy.installPermissionCallback).toBe(true);
  });

  it("blocks official t3.codes / ping.gg relay URLs and routes hosted defaults to self-hosted ECS", () => {
    expect(normalizeSecureRelayUrl("https://relay.t3.codes")).toBeNull();
    expect(normalizeSecureRelayUrl("https://api.t3.codes")).toBeNull();
    expect(normalizeSecureRelayUrl("https://ping.gg")).toBeNull();
    expect(normalizeSecureRelayUrl("https://t3.bobmcmxciv.xin")).toBe("https://t3.bobmcmxciv.xin");

    expect(DEFAULT_HOSTED_APP_URL).toBe("https://t3.bobmcmxciv.xin");
    expect(providerAuthReturnUrl("https://app.t3.codes/settings")).toBeUndefined();
    expect(providerAuthReturnUrl("https://vircs.t3.bobmcmxciv.xin/settings")).toBe(
      "https://vircs.t3.bobmcmxciv.xin/settings",
    );
    expect(cliReleaseDownloadBaseUrl("0.1.11")).toBe(
      "https://t3.bobmcmxciv.xin/t3/releases/v0.1.11",
    );
    expect(cliReleaseIndexPageUrl(1)).toBe(
      "https://t3.bobmcmxciv.xin/t3/releases/index.json?page=1",
    );
  });

  it("never leaks hostnames to Google favicon service", () => {
    expect(faviconUrlForOrigin("https://intranet.internal.corp/dashboard")).toBeNull();
    expect(faviconUrlForOrigin("https://github.com/bobmcmxciv/t3code")).toBeNull();
  });

  it("disables relay tracing by default and blocks Axiom endpoints", () => {
    expect(isRelayTracingEnabled({})).toBe(false);
    expect(
      resolveRelayClientTracingConfig({
        T3CODE_TELEMETRY_ENABLED: "true",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "ds",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "tok",
      }),
    ).toBeNull();
  });

  it.effect("disables GitHub star probing and arbitrary repo starring via server credentials", () =>
    Effect.gen(function* () {
      const checkStarred = yield* makeIsRepositoryStarred;
      const starRepo = yield* makeStarRepository;
      expect(yield* checkStarred("github.com", "pingdotgg/t3code")).toBe(false);
      expect(yield* starRepo("github.com", "pingdotgg/t3code")).toBe(false);
    }),
  );

  it.effect(
    "keeps AnalyticsService and Identify strictly silent without writing anonymous-id or calling ingest.t3.codes",
    () =>
      Effect.gen(function* () {
        const tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-hardening-test-"));
        try {
          let outboundRequests = 0;
          const mockHttpClient = HttpClient.make((req) => {
            outboundRequests += 1;
            return Effect.succeed(
              HttpClientResponse.fromWeb(req, new Response("ok", { status: 200 })),
            );
          });
          const layer = AnalyticsService.layer.pipe(
            // An explicit base dir outlives the layer, so the file check below sees real state.
            Layer.provideMerge(ServerConfig.ServerConfig.layerTest(tmpDir, tmpDir)),
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                NodeCrypto.layer,
                Layer.succeed(HostProcess.Platform, "win32"),
                Layer.succeed(HostProcess.Architecture, "x64"),
                Layer.succeed(HostProcess.Environment, {}),
                Layer.succeed(HttpClient.HttpClient, mockHttpClient),
                ManagedPolicy.layerTest(),
              ),
            ),
          );
          const { recorded, anonymousIdPath } = yield* Effect.gen(function* () {
            const analytics = yield* AnalyticsService.AnalyticsService;
            const config = yield* ServerConfig.ServerConfig;
            const ok = yield* analytics.record("client.turn.requested", { model: "private-model" });
            yield* analytics.flush;
            return { recorded: ok, anonymousIdPath: config.anonymousIdPath };
          }).pipe(Effect.provide(layer));

          expect(recorded).toBe(false);
          expect(outboundRequests).toBe(0);
          // The state path the server would write, not a path nothing could touch.
          expect(anonymousIdPath.startsWith(tmpDir)).toBe(true);
          expect(NodeFS.existsSync(anonymousIdPath)).toBe(false);

          const identity = yield* getTelemetryIdentity;
          const owners = yield* getServerOwners;
          expect(identity).toEqual({ distinctId: null, installId: null });
          expect(owners).toEqual([]);
        } finally {
          NodeFS.rmSync(tmpDir, { recursive: true, force: true });
        }
      }),
  );
});
