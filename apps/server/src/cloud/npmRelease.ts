import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import { cliReleaseChannelOf, npmReleaseDatabaseMigration } from "@t3tools/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/));
const Manifest = Schema.Struct({ version: Version, t3code: Schema.optionalKey(Schema.Unknown) });
// A mirror may answer with a bare version string when the release has no `t3code` field.
const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([Manifest, Schema.Tuple([Manifest]), Version])),
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

/** A track spec only matches a release on that track, so a mirror cannot pass a build across tracks. */
function specMatches(spec: string, version: string) {
  if (spec === "latest") return cliReleaseChannelOf(version) === "stable";
  if (spec === "nightly") return cliReleaseChannelOf(version) === "nightly";
  return version === spec;
}

function toRelease(spec: string, json: string) {
  const decoded = Option.getOrUndefined(decodeManifest(json));
  const manifest =
    typeof decoded === "string"
      ? { version: decoded }
      : decoded && ("version" in decoded ? decoded : decoded[0]);
  if (!manifest || !specMatches(spec, manifest.version)) {
    return Effect.fail(
      new ServerNpmReleaseError({
        reason: "The release mirror returned invalid release metadata.",
      }),
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
  const configuredBaseUrl = yield* Config.String("T3CODE_RELEASE_META_BASE_URL").pipe(
    Config.withDefault(""),
    Effect.orElseSucceed(() => ""),
  );
  const baseUrl = (configuredBaseUrl.trim() || DEFAULT_RELEASE_META_BASE_URL).replace(/\/+$/, "");
  const lookupSelfHosted = Effect.fn("NpmRelease.lookupSelfHosted")(function* (spec: string) {
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

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
