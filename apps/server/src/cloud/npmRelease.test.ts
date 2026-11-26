import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Result from "effect/Result";

import * as NpmRelease from "./npmRelease.ts";

const stable = "0.1.1201";
const nightly = "0.1.1202-nightly.20261126.1";

const mirror = (respond: (spec: string) => Response) => {
  const requested: string[] = [];
  const http = HttpClient.make((request) => {
    const url = new URL(request.url);
    requested.push(url.toString());
    const spec = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    return Effect.succeed(HttpClientResponse.fromWeb(request, respond(spec)));
  });
  return {
    requested,
    service: NpmRelease.make().pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
};

it.effect.each([
  { spec: stable, body: { version: stable, t3code: { databaseMigration: 130 } }, migration: 130 },
  { spec: "latest", body: { version: stable, t3code: { databaseMigration: 130 } }, migration: 130 },
  { spec: "nightly", body: { version: nightly }, migration: undefined },
])("reads $spec from the self-hosted mirror once and keeps its migration head", (fixture) =>
  Effect.gen(function* () {
    const { requested, service } = mirror(() => Response.json(fixture.body));
    const releases = yield* service;
    const expected = {
      version: fixture.body.version,
      ...(fixture.migration === undefined ? {} : { databaseMigration: fixture.migration }),
    };
    expect(yield* releases.get({ spec: fixture.spec })).toEqual(expected);
    expect(yield* releases.get({ spec: fixture.spec })).toEqual(expected);
    expect(requested).toEqual([
      `https://t3.bobmcmxciv.xin/t3/releases/meta/${encodeURIComponent(fixture.spec)}`,
    ]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("treats a mirror 404 as unpublished", () =>
  Effect.gen(function* () {
    const { service } = mirror(() =>
      Response.json({ error: "release_not_found" }, { status: 404 }),
    );
    expect(yield* (yield* service).get({ spec: "9.9.9" })).toBeNull();
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each([
  { name: "a server error", spec: "latest", response: () => new Response("", { status: 502 }) },
  { name: "non-JSON", spec: "latest", response: () => new Response("<html>login</html>") },
  { name: "another version", spec: "9.9.9", response: () => Response.json({ version: stable }) },
  // A mirror must not hand a nightly to stable users, or a stable build to the nightly track.
  {
    name: "a nightly as latest",
    spec: "latest",
    response: () => Response.json({ version: nightly }),
  },
  {
    name: "a stable build as nightly",
    spec: "nightly",
    response: () => Response.json({ version: stable }),
  },
])("reports $name as a failed lookup rather than a release", (fixture) =>
  Effect.gen(function* () {
    const { service } = mirror(fixture.response);
    const result = yield* (yield* service).get({ spec: fixture.spec }).pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ServerNpmReleaseError);
  }).pipe(Effect.provide(NodeServices.layer)),
);
