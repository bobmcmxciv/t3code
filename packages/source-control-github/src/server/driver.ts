import { SourceControlSignInError, type SourceControlProviderKind } from "@t3tools/contracts";
import {
  defineSourceControlDriver,
  withOwnServices,
  type SourceControlSignIn,
} from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import { definition } from "../shared/definition.ts";

import * as GitHubAppAccess from "./GitHubAppAccess.ts";
import * as GitHubAppSignIn from "./GitHubAppSignIn.ts";
import * as GitHubMediaFetch from "./gitHubMediaFetch.ts";
import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubHttpClient from "./GitHubHttpClient.ts";
import * as GitHubIssueTracker from "./GitHubIssueTracker.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

// `GitHubRest.layerWithDependencies` carries the quota reserve every GitHub reader shares, so it
// must be built once; the driver is.
const services = GitHubPullRequestApi.layer.pipe(
  Layer.provideMerge(GitHubAppAccess.layer),
  Layer.provideMerge(GitHubRest.layerWithDependencies),
  Layer.provideMerge(GitHubHttpClient.layer),
);

const makeSignIn = Effect.gen(function* () {
  const appSignIn = yield* GitHubAppSignIn.GitHubAppSignIn;
  const appAccess = yield* GitHubAppAccess.GitHubAppAccess;
  const kind: SourceControlProviderKind = definition.kind;
  return {
    start: appSignIn.start,
    wait: (host) =>
      appSignIn.wait(host).pipe(
        Effect.andThen(
          appAccess.viewer(host).pipe(
            Effect.mapError(
              (cause) =>
                new SourceControlSignInError({
                  provider: kind,
                  host,
                  reason: "failed",
                  detail: "Signed in, but GitHub would not say which account it belongs to.",
                  cause,
                }),
            ),
          ),
        ),
        Effect.map((account) => ({ account })),
      ),
    cancel: appSignIn.cancel,
    access: appAccess.reach,
  } satisfies SourceControlSignIn;
});

const starredPath = (repository: string) => {
  const segments = repository.split("/");
  // "." and ".." survive encoding and would normalize the URL out of user/starred.
  return segments.length === 2 && segments.every((segment) => !["", ".", ".."].includes(segment))
    ? `user/starred/${segments.map(encodeURIComponent).join("/")}`
    : undefined;
};

// Disabled in self-hosted hardened fork: never probe or mutate GitHub stars using host credentials.
export const makeIsRepositoryStarred = Effect.succeed(
  (_host: string, _repository: string): Effect.Effect<boolean> => Effect.succeed(false),
);

export const makeStarRepository = Effect.succeed(
  (_host: string, _repository: string): Effect.Effect<boolean> => Effect.succeed(false),
);

const makeInstance = Effect.gen(function* () {
  const mediaHttpClient = yield* HttpClient.HttpClient;
  return yield* withOwnServices(
    Effect.all({
      sourceControl: GitHubSourceControlProvider.make,
      discovery: GitHubSourceControlProvider.makeDiscovery,
      pullRequests: GitHubPullRequestProvider.make,
      issues: GitHubIssueTracker.make,
      fetchMedia: GitHubMediaFetch.make.pipe(
        Effect.provideService(HttpClient.HttpClient, mediaHttpClient),
      ),
      signIn: makeSignIn,
      isRepositoryStarred: makeIsRepositoryStarred,
      starRepository: makeStarRepository,
    }),
    services,
  );
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: makeInstance,
});
