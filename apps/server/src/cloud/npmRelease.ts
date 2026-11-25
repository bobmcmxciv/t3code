import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import { npmReleaseDatabaseMigration } from "@t3tools/shared/cliRelease";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as ProcessRunner from "../processRunner.ts";

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/));
const Manifest = Schema.Struct({ version: Version, t3code: Schema.optionalKey(Schema.Unknown) });
// npm prints a bare version string when the release has no `t3code` field.
const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([Manifest, Schema.Tuple([Manifest]), Version])),
);
const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.Struct({ code: Schema.String }) })),
);
const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

function toRelease(spec: string, json: string) {
  const decoded = Option.getOrUndefined(decodeManifest(json));
  const manifest =
    typeof decoded === "string"
      ? { version: decoded }
      : decoded && ("version" in decoded ? decoded : decoded[0]);
  if (!manifest || (spec !== "latest" && spec !== "nightly" && manifest.version !== spec)) {
    return Effect.fail(
      new ServerNpmReleaseError({ reason: "npm returned invalid release metadata." }),
    );
  }
  const databaseMigration = npmReleaseDatabaseMigration(manifest);
  return Effect.succeed({
    version: manifest.version,
    ...(databaseMigration === undefined ? {} : { databaseMigration }),
  });
}

const DEFAULT_RELEASE_META_BASE_URL = "https://t3.bobmcmxciv.xin/t3/releases/meta";

export const make = Effect.fn("NpmRelease.make")(function* () {
  const http = yield* HttpClient.HttpClient;
  const lookupSelfHosted = Effect.fn("NpmRelease.lookupSelfHosted")(function* (spec: string) {
    const baseUrl = (
      process.env.T3CODE_RELEASE_META_BASE_URL?.trim() || DEFAULT_RELEASE_META_BASE_URL
    ).replace(/\/+$/, "");
    const unreachable = new ServerNpmReleaseError({
      reason: "Self-hosted release metadata endpoint could not be reached.",
    });
    const json = yield* Effect.gen(function* () {
      const response = yield* http.get(`${baseUrl}/${encodeURIComponent(spec)}`);
      if (response.status === 404) return Option.none<string>();
      if (response.status < 200 || response.status >= 300) return yield* unreachable;
      return Option.some(yield* response.text);
    }).pipe(
      Effect.timeout(Duration.seconds(15)),
      Effect.mapError(() => unreachable),
    );
    return Option.isNone(json) ? null : yield* toRelease(spec, json.value);
  });
  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: lookupSelfHosted,
  });
  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(
  Layer.provide([ProcessRunner.layer, FetchHttpClient.layer]),
);
