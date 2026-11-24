// @effect-diagnostics nodeBuiltinImport:off -- exclusive copy and streaming hashes are filesystem boundaries missing from Effect's API.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import {
  ATTACHMENT_UPLOAD_URL_TTL_MS,
  type AttachmentCreateUploadUrlInput,
  AttachmentUploadSigningKeyError,
} from "@t3tools/contracts";
import { isSvgAttachment } from "@t3tools/shared/image";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";

import {
  attachmentFileExtension,
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
  sweepStalePendingAttachments,
} from "../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { base64UrlDecodeUtf8, base64UrlEncode } from "../auth/utils.ts";
import * as AssetSigner from "./AssetSigner.ts";
import * as ServerConfig from "../config.ts";
import { inferImageExtension } from "../imageMime.ts";
import * as DocumentText from "../provider/DocumentText.ts";

export const ATTACHMENT_UPLOAD_ROUTE_PREFIX = "/api/attachments/upload";

const PENDING_ATTACHMENT_SWEEP_INTERVAL_MS = 15 * 60_000;
const lastPendingSweepByDirectory = new Map<string, number>();

const AttachmentUploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("attachment-upload"),
  type: Schema.Literals(["image", "file"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("image" as const)),
  ),
  attachmentId: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  expiresAt: Schema.Number,
});
export type AttachmentUploadClaims = typeof AttachmentUploadClaims.Type;

const attachmentUploadClaimsJson = Schema.fromJsonString(AttachmentUploadClaims);
const decodeAttachmentUploadClaims = Schema.decodeUnknownOption(attachmentUploadClaimsJson);
const encodeAttachmentUploadClaims = Schema.encodeSync(attachmentUploadClaimsJson);

function decodeClaims(encodedPayload: string): AttachmentUploadClaims | null {
  try {
    return Option.getOrNull(decodeAttachmentUploadClaims(base64UrlDecodeUtf8(encodedPayload)));
  } catch {
    return null;
  }
}

export const issueAttachmentUploadUrl = Effect.fn("AttachmentUpload.issueUrl")(function* (
  input: AttachmentCreateUploadUrlInput,
) {
  const config = yield* ServerConfig.ServerConfig;
  const nowMs = yield* Clock.currentTimeMillis;
  const previousSweep = lastPendingSweepByDirectory.get(config.attachmentsDir);
  if (
    previousSweep === undefined ||
    nowMs - previousSweep >= PENDING_ATTACHMENT_SWEEP_INTERVAL_MS
  ) {
    lastPendingSweepByDirectory.set(config.attachmentsDir, nowMs);
    const swept = sweepStalePendingAttachments({
      attachmentsDir: config.attachmentsDir,
      nowMs,
    });
    if (swept.deleted > 0) {
      yield* Effect.logInfo("Removed expired attachment uploads.", { deleted: swept.deleted });
    }
  }

  const attachmentType = input.type ?? "image";
  const name =
    attachmentType === "file" && isSvgAttachment(input) && !/\.svg$/i.test(input.name)
      ? `${input.name}.svg`
      : input.name;
  const attachmentId = createPendingAttachmentId(
    attachmentType === "file" ? attachmentFileExtension(name) : undefined,
  );
  const expiresAt = nowMs + ATTACHMENT_UPLOAD_URL_TTL_MS;
  const encodedPayload = base64UrlEncode(
    encodeAttachmentUploadClaims({
      version: 1,
      kind: "attachment-upload",
      type: attachmentType,
      attachmentId,
      name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      expiresAt,
    }),
  );

  const signer = yield* AssetSigner.AssetSigner;
  const signature = yield* signer
    .sign(encodedPayload)
    .pipe(Effect.mapError((cause) => new AttachmentUploadSigningKeyError({ cause })));
  return {
    attachmentId,
    relativeUrl: `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/${encodedPayload}.${signature}`,
    expiresAt,
  };
});

export const validateAttachmentUploadToken = Effect.fn("AttachmentUpload.validateToken")(function* (
  token: string,
) {
  const [encodedPayload, signature, unexpectedSegment] = token.split(".");
  if (!encodedPayload || !signature || unexpectedSegment) {
    return null;
  }

  const signer = yield* AssetSigner.AssetSigner;
  const verified = yield* signer.verify(encodedPayload, signature).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Failed to load the attachment upload signing key.", { cause }),
    ),
    Effect.orElseSucceed(() => false),
  );
  if (!verified) {
    return null;
  }

  const claims = decodeClaims(encodedPayload);
  if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) {
    return null;
  }
  return claims;
});

export type StoreAttachmentUploadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly detail: string };

export const storeAttachmentUpload = Effect.fn("AttachmentUpload.store")(function* (
  claims: AttachmentUploadClaims,
  body: Uint8Array | HttpServerRequest.HttpServerRequest["stream"],
) {
  if (body instanceof Uint8Array && body.byteLength !== claims.sizeBytes) {
    return {
      ok: false,
      status: 400,
      detail: `Body was ${body.byteLength} bytes, expected ${claims.sizeBytes}.`,
    } satisfies StoreAttachmentUploadResult;
  }

  const config = yield* ServerConfig.ServerConfig;
  const extension =
    claims.type === "file"
      ? attachmentFileExtension(claims.name)
      : inferImageExtension({ mimeType: claims.mimeType, fileName: claims.name });
  const relativePath = `${claims.attachmentId}${extension}`;
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath,
  });
  const random = yield* SecureRandom.SecureRandom;
  const partId = yield* random.uuidV4();
  const partPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.${partId}.part`,
  });
  if (!finalPath || !partPath) {
    return { ok: false, status: 500, detail: "Failed to resolve attachment path." };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let receivedBytes = 0;
  const bodyStream = body instanceof Uint8Array ? Stream.make(body) : body;
  return yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(path.dirname(finalPath), { recursive: true });
    yield* Stream.run(
      bodyStream.pipe(
        Stream.takeWhile((chunk) => {
          receivedBytes += chunk.byteLength;
          return receivedBytes <= claims.sizeBytes;
        }),
      ),
      fileSystem.sink(partPath),
    );
    if (receivedBytes !== claims.sizeBytes) {
      return {
        ok: false,
        status: 400,
        detail: `Body was ${receivedBytes} bytes, expected ${claims.sizeBytes}.`,
      } satisfies StoreAttachmentUploadResult;
    }
    // Publishing without replacement keeps an upload and its cached text immutable.
    const published = yield* fileSystem.link(partPath, finalPath).pipe(
      Effect.as(true),
      Effect.catch((error) => {
        if (error.reason._tag === "AlreadyExists") return Effect.succeed(false);
        return Effect.tryPromise({
          try: () => NodeFSP.copyFile(partPath, finalPath, NodeFSP.constants.COPYFILE_EXCL),
          catch: (cause) =>
            PlatformError.systemError({
              _tag:
                cause instanceof Error && "code" in cause && cause.code === "EEXIST"
                  ? "AlreadyExists"
                  : "Unknown",
              module: "FileSystem",
              method: "copyFile",
              pathOrDescriptor: finalPath,
              cause,
            }),
        }).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error.reason._tag === "AlreadyExists",
            () => Effect.succeed(false),
          ),
        );
      }),
    );
    if (!published) {
      if (Number((yield* fileSystem.stat(finalPath)).size) !== receivedBytes) {
        return { ok: false, status: 409, detail: "Attachment already uploaded." };
      }
      const hashes = yield* Effect.forEach([partPath, finalPath], (file) =>
        fileSystem.stream(file).pipe(
          Stream.runFold(
            () => NodeCrypto.createHash("sha256"),
            (hash, chunk) => hash.update(chunk),
          ),
          Effect.map((hash) => hash.digest("hex")),
        ),
      );
      if (hashes[0] !== hashes[1]) {
        return { ok: false, status: 409, detail: "Attachment already uploaded." };
      }
    }
    const documents = yield* DocumentText.DocumentText;
    yield* documents.ensure(finalPath);
    return { ok: true } satisfies StoreAttachmentUploadResult;
  }).pipe(
    Effect.catch((cause) =>
      Effect.logError("Failed to persist attachment upload.", {
        attachmentId: claims.attachmentId,
        cause,
      }).pipe(
        Effect.as({
          ok: false,
          status: 500,
          detail: "Failed to persist upload.",
        } satisfies StoreAttachmentUploadResult),
      ),
    ),
    Effect.ensuring(
      fileSystem.remove(partPath, { force: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  );
});

export const MAX_ATTACHMENT_UPLOAD_CHUNKS = 256;

function resolveAttachmentRelativePaths(config: { readonly attachmentsDir: string }, claims: AttachmentUploadClaims) {
  const extension =
    claims.type === "file"
      ? attachmentFileExtension(claims.name)
      : inferImageExtension({ mimeType: claims.mimeType, fileName: claims.name });
  const relativePath = `${claims.attachmentId}${extension}`;
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath,
  });
  const chunksDir = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.chunks`,
  });
  return { relativePath, finalPath, chunksDir };
}

export const storeAttachmentUploadChunk = Effect.fn("AttachmentUpload.storeChunk")(function* (
  claims: AttachmentUploadClaims,
  input: {
    readonly chunkIndex: number;
    readonly totalChunks: number;
    readonly offset: number;
  },
  body: Uint8Array | HttpServerRequest.HttpServerRequest["stream"],
) {
  if (
    !Number.isInteger(input.chunkIndex) ||
    !Number.isInteger(input.totalChunks) ||
    !Number.isInteger(input.offset) ||
    input.totalChunks < 1 ||
    input.totalChunks > MAX_ATTACHMENT_UPLOAD_CHUNKS ||
    input.chunkIndex < 0 ||
    input.chunkIndex >= input.totalChunks ||
    input.offset < 0 ||
    input.offset >= claims.sizeBytes
  ) {
    return {
      ok: false,
      status: 400,
      detail: "Invalid chunk parameters.",
    } satisfies StoreAttachmentUploadResult;
  }

  const config = yield* ServerConfig.ServerConfig;
  const { relativePath, chunksDir } = resolveAttachmentRelativePaths(config, claims);
  if (!chunksDir) {
    return { ok: false, status: 500, detail: "Failed to resolve chunk path." };
  }
  const random = yield* SecureRandom.SecureRandom;
  const partId = yield* random.uuidV4();
  const chunkFileName = `chunk-${String(input.chunkIndex).padStart(4, "0")}.bin`;
  const chunkPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.chunks/${chunkFileName}`,
  });
  const tmpChunkPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.chunks/${chunkFileName}.${partId}.part`,
  });
  if (!chunkPath || !tmpChunkPath) {
    return { ok: false, status: 500, detail: "Failed to resolve chunk path." };
  }

  const maxAllowed = claims.sizeBytes - input.offset;
  const fileSystem = yield* FileSystem.FileSystem;
  let receivedBytes = 0;
  let exceeded = false;
  const bodyStream = body instanceof Uint8Array ? Stream.make(body) : body;

  return yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(chunksDir, { recursive: true });
    yield* Stream.run(
      bodyStream.pipe(
        Stream.takeWhile((chunk) => {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > maxAllowed) {
            exceeded = true;
            return false;
          }
          return true;
        }),
      ),
      fileSystem.sink(tmpChunkPath),
    );
    if (exceeded || receivedBytes === 0) {
      return {
        ok: false,
        status: 400,
        detail: exceeded ? "Chunk exceeds declared attachment size." : "Empty chunk body.",
      } satisfies StoreAttachmentUploadResult;
    }
    yield* fileSystem.rename(tmpChunkPath, chunkPath);
    return { ok: true } satisfies StoreAttachmentUploadResult;
  }).pipe(
    Effect.catch((cause) =>
      Effect.logError("Failed to persist attachment upload chunk.", {
        attachmentId: claims.attachmentId,
        chunkIndex: input.chunkIndex,
        cause,
      }).pipe(
        Effect.as({
          ok: false,
          status: 500,
          detail: "Failed to persist upload chunk.",
        } satisfies StoreAttachmentUploadResult),
      ),
    ),
    Effect.ensuring(
      fileSystem.remove(tmpChunkPath, { force: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  );
});

export const completeAttachmentUploadChunks = Effect.fn("AttachmentUpload.completeChunks")(function* (
  claims: AttachmentUploadClaims,
  input: { readonly totalChunks: number },
) {
  if (
    !Number.isInteger(input.totalChunks) ||
    input.totalChunks < 1 ||
    input.totalChunks > MAX_ATTACHMENT_UPLOAD_CHUNKS
  ) {
    return {
      ok: false,
      status: 400,
      detail: "Invalid chunk count.",
    } satisfies StoreAttachmentUploadResult;
  }

  const config = yield* ServerConfig.ServerConfig;
  const { relativePath, finalPath, chunksDir } = resolveAttachmentRelativePaths(config, claims);
  const random = yield* SecureRandom.SecureRandom;
  const partId = yield* random.uuidV4();
  const partPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.${partId}.part`,
  });
  if (!finalPath || !chunksDir || !partPath) {
    return { ok: false, status: 500, detail: "Failed to resolve attachment path." };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* Effect.gen(function* () {
    const chunkPaths: string[] = [];
    let totalBytes = 0;
    for (let i = 0; i < input.totalChunks; i += 1) {
      const chunkPath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: `${relativePath}.chunks/chunk-${String(i).padStart(4, "0")}.bin`,
      });
      if (!chunkPath) {
        return { ok: false, status: 500, detail: "Failed to resolve chunk path." };
      }
      const stat = yield* fileSystem.stat(chunkPath).pipe(Effect.option);
      if (Option.isNone(stat)) {
        return {
          ok: false,
          status: 400,
          detail: `Missing uploaded chunk ${i} of ${input.totalChunks}.`,
        } satisfies StoreAttachmentUploadResult;
      }
      totalBytes += Number(stat.value.size);
      chunkPaths.push(chunkPath);
    }
    if (totalBytes !== claims.sizeBytes) {
      return {
        ok: false,
        status: 400,
        detail: `Assembled size was ${totalBytes} bytes, expected ${claims.sizeBytes}.`,
      } satisfies StoreAttachmentUploadResult;
    }

    yield* fileSystem.makeDirectory(path.dirname(finalPath), { recursive: true });
    const assembledStream = Stream.fromIterable(chunkPaths).pipe(
      Stream.flatMap((cp) => fileSystem.stream(cp)),
    );
    yield* Stream.run(assembledStream, fileSystem.sink(partPath));

    const published = yield* fileSystem.link(partPath, finalPath).pipe(
      Effect.as(true),
      Effect.catch((error) => {
        if (error.reason._tag === "AlreadyExists") return Effect.succeed(false);
        return Effect.tryPromise({
          try: () => NodeFSP.copyFile(partPath, finalPath, NodeFSP.constants.COPYFILE_EXCL),
          catch: (cause) =>
            PlatformError.systemError({
              _tag:
                cause instanceof Error && "code" in cause && cause.code === "EEXIST"
                  ? "AlreadyExists"
                  : "Unknown",
              module: "FileSystem",
              method: "copyFile",
              pathOrDescriptor: finalPath,
              cause,
            }),
        }).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error.reason._tag === "AlreadyExists",
            () => Effect.succeed(false),
          ),
        );
      }),
    );
    if (!published) {
      if (Number((yield* fileSystem.stat(finalPath)).size) !== claims.sizeBytes) {
        return { ok: false, status: 409, detail: "Attachment already uploaded." };
      }
      const hashes = yield* Effect.forEach([partPath, finalPath], (file) =>
        fileSystem.stream(file).pipe(
          Stream.runFold(
            () => NodeCrypto.createHash("sha256"),
            (hash, chunk) => hash.update(chunk),
          ),
          Effect.map((hash) => hash.digest("hex")),
        ),
      );
      if (hashes[0] !== hashes[1]) {
        return { ok: false, status: 409, detail: "Attachment already uploaded." };
      }
    }

    const documents = yield* DocumentText.DocumentText;
    yield* documents.ensure(finalPath);
    yield* fileSystem
      .remove(chunksDir, { recursive: true, force: true })
      .pipe(Effect.orElseSucceed(() => undefined));
    return { ok: true } satisfies StoreAttachmentUploadResult;
  }).pipe(
    Effect.catch((cause) =>
      Effect.logError("Failed to finalize chunked attachment upload.", {
        attachmentId: claims.attachmentId,
        cause,
      }).pipe(
        Effect.as({
          ok: false,
          status: 500,
          detail: "Failed to finalize upload.",
        } satisfies StoreAttachmentUploadResult),
      ),
    ),
    Effect.ensuring(
      fileSystem.remove(partPath, { force: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  );
});

export const deletePendingAttachment = Effect.fn("AttachmentUpload.deletePending")(function* (
  attachmentId: string,
) {
  if (parseThreadSegmentFromAttachmentId(attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT) {
    return;
  }

  const config = yield* ServerConfig.ServerConfig;
  const attachmentPath = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId,
  });
  if (!attachmentPath) {
    return;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.remove(attachmentPath, { force: true }).pipe(Effect.orElseSucceed(() => {}));
  yield* fileSystem.remove(`${attachmentPath}.txt`, { force: true }).pipe(Effect.ignore);
});
