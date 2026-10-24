import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
};
type Environment = Readonly<Record<string, string | undefined>>;
export type MediaStorageConfig =
  | { mode: 'local'; root: string }
  | { mode: 's3'; endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; bucket: string };

/** Safe for HTTP responses and logs: SDK errors and credentials are never included. */
export class MediaStorageError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'MediaStorageError';
  }
}

export interface StoredMedia { body: Buffer; contentType: string }
export interface MediaStorage {
  readonly mode: 'local' | 's3';
  putMedia(filename: string, body: Buffer, privateFile?: boolean): Promise<void>;
  getMedia(filename: string, privateFile?: boolean): Promise<StoredMedia>;
  deleteMedia(filename: string, privateFile?: boolean): Promise<void>;
}
export interface S3ClientLike {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}
export interface MediaStorageDependencies { s3Client?: S3ClientLike }

function error(status: number, code: string, message: string): MediaStorageError {
  return new MediaStorageError(status, code, message);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function errorCode(value: unknown): string | undefined {
  const candidate = record(value).code;
  return typeof candidate === 'string' ? candidate : undefined;
}
function notFound(value: unknown): boolean {
  const item = record(value), metadata = record(item.$metadata);
  return item.name === 'NoSuchKey' || item.name === 'NotFound' || metadata.httpStatusCode === 404;
}
function unavailable(): MediaStorageError {
  return error(503, 'MEDIA_UNAVAILABLE', 'Media storage is temporarily unavailable.');
}

/** Filenames are single image basenames, never URLs, keys, or filesystem paths. */
export function assertMediaFilename(filename: string): string {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(filename)
    || filename.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(filename)
    || !CONTENT_TYPES[path.extname(filename).toLowerCase()]) {
    throw error(400, 'MEDIA_FILENAME', 'Invalid media filename.');
  }
  return filename;
}
function contentType(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()];
}
function key(filename: string, privateFile: boolean): string {
  return `${privateFile ? 'private' : 'products'}/${assertMediaFilename(filename)}`;
}
function assertBody(body: Buffer): void {
  if (!Buffer.isBuffer(body) || body.byteLength === 0) throw error(400, 'MEDIA_BODY', 'An image is required.');
  if (body.byteLength > MEDIA_MAX_BYTES) throw error(413, 'MEDIA_TOO_LARGE', 'The image exceeds the storage size limit.');
}

export function readMediaStorageConfig(env: Environment = process.env): MediaStorageConfig {
  const mode = (env.MEDIA_STORAGE || 'local').trim().toLowerCase();
  if (mode !== 'local' && mode !== 's3') throw new Error('MEDIA_STORAGE must be local or s3.');
  if (mode === 'local') {
    // Netlify/AWS Functions have ephemeral filesystems. Local mode is only safe
    // in development or on a server with an explicitly mounted persistent disk.
    const functionsHost = env.NETLIFY === 'true' || env.NETLIFY === '1'
      || !!env.AWS_LAMBDA_FUNCTION_NAME || !!env.LAMBDA_TASK_ROOT
      || (!!env.SITE_ID && !!env.DEPLOY_ID);
    if (env.NODE_ENV === 'production' && functionsHost) {
      throw new Error('MEDIA_STORAGE=s3 is required for production functions; local media would not persist.');
    }
    return { mode, root: path.resolve(env.UPLOAD_DIR || env.STORAGE_DIR || './storage') };
  }
  const values = {
    S3_ENDPOINT: env.S3_ENDPOINT || env.AWS_ENDPOINT_URL_S3,
    S3_REGION: env.S3_REGION,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
  };
  const missing = Object.entries(values).filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length) throw new Error(`Missing media storage configuration: ${missing.join(', ')}.`);
  let endpoint: URL;
  try { endpoint = new URL(values.S3_ENDPOINT!); } catch { throw new Error('S3_ENDPOINT must be a valid HTTPS URL.'); }
  const localHttp = env.NODE_ENV !== 'production' && endpoint.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if ((!localHttp && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('S3_ENDPOINT must be an HTTPS URL without credentials, query, or fragment.');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values.S3_BUCKET!) || values.S3_BUCKET!.includes('..')) {
    throw new Error('S3_BUCKET must be a valid bucket name.');
  }
  return { mode, endpoint: endpoint.href, region: values.S3_REGION!.trim(),
    accessKeyId: values.S3_ACCESS_KEY_ID!, secretAccessKey: values.S3_SECRET_ACCESS_KEY!, bucket: values.S3_BUCKET! };
}

/** Reject directory junctions as well as symlinks, including configured ancestors. */
async function noLinks(absolute: string): Promise<void> {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw error(400, 'MEDIA_PATH', 'Linked media paths are not allowed.');
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') return;
      throw cause;
    }
  }
}
async function checkedFile(root: string, filename: string, privateFile: boolean): Promise<string> {
  const location = path.join(root, key(filename, privateFile));
  await noLinks(location);
  return location;
}
function localFailure(cause: unknown): never {
  if (cause instanceof MediaStorageError) throw cause;
  if (errorCode(cause) === 'ENOENT' || errorCode(cause) === 'ENOTDIR') throw error(404, 'MEDIA_NOT_FOUND', 'Image not found.');
  if (errorCode(cause) === 'EEXIST') throw error(409, 'MEDIA_EXISTS', 'This image filename already exists.');
  throw unavailable();
}

function localStorage(config: Extract<MediaStorageConfig, { mode: 'local' }>): MediaStorage {
  return {
    mode: 'local',
    async putMedia(filename, body, privateFile = false) {
      assertMediaFilename(filename); assertBody(body);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const location = await checkedFile(config.root, filename, privateFile);
        await mkdir(path.dirname(location), { recursive: true });
        await noLinks(location);
        // Exclusive creation protects existing images and rejects symlink targets.
        // Callers already generate fresh UUID filenames for every image upload.
        handle = await open(location, 'wx', 0o600);
        await handle.writeFile(body);
      } catch (cause) { localFailure(cause); }
      finally { await handle?.close(); }
    },
    async getMedia(filename, privateFile = false) {
      assertMediaFilename(filename);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const location = await checkedFile(config.root, filename, privateFile);
        const before = await lstat(location);
        if (!before.isFile() || before.nlink !== 1) throw error(400, 'MEDIA_PATH', 'Linked or non-file media paths are not allowed.');
        handle = await open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) {
          throw error(400, 'MEDIA_PATH', 'The media path changed during access.');
        }
        await noLinks(location);
        if (stat.size > MEDIA_MAX_BYTES) throw error(413, 'MEDIA_TOO_LARGE', 'The image exceeds the storage size limit.');
        const chunks: Buffer[] = [];
        let bytes = 0;
        while (true) {
          const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MEDIA_MAX_BYTES + 1 - bytes));
          const { bytesRead } = await handle.read(chunk);
          if (!bytesRead) break;
          bytes += bytesRead;
          if (bytes > MEDIA_MAX_BYTES) throw error(413, 'MEDIA_TOO_LARGE', 'The image exceeds the storage size limit.');
          chunks.push(chunk.subarray(0, bytesRead));
        }
        return { body: Buffer.concat(chunks, bytes), contentType: contentType(filename) };
      } catch (cause) { return localFailure(cause); }
      finally { await handle?.close(); }
    },
    async deleteMedia(filename, privateFile = false) {
      assertMediaFilename(filename);
      try {
        const location = await checkedFile(config.root, filename, privateFile);
        const stat = await lstat(location);
        if (!stat.isFile() || stat.nlink !== 1) throw error(400, 'MEDIA_PATH', 'Linked or non-file media paths are not allowed.');
        await unlink(location);
      } catch (cause) {
        if (errorCode(cause) === 'ENOENT') return;
        localFailure(cause);
      }
    },
  };
}

async function limitedBody(value: unknown, signal: AbortSignal): Promise<Buffer> {
  const item = record(value);
  const destroy = () => { if (typeof item.destroy === 'function') item.destroy.call(value); };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    if (value.byteLength > MEDIA_MAX_BYTES) throw error(413, 'MEDIA_TOO_LARGE', 'The image exceeds the storage size limit.');
    return Buffer.from(value);
  }
  if (!value || typeof item[Symbol.asyncIterator as unknown as string] !== 'function') throw unavailable();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => { destroy(); reject(unavailable()); };
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  const consume = async () => {
    try {
      for await (const valueChunk of value as AsyncIterable<unknown>) {
        if (!(valueChunk instanceof Uint8Array) && typeof valueChunk !== 'string') throw unavailable();
        const chunk = Buffer.from(valueChunk as Uint8Array);
        bytes += chunk.byteLength;
        if (bytes > MEDIA_MAX_BYTES) throw error(413, 'MEDIA_TOO_LARGE', 'The image exceeds the storage size limit.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, bytes);
    } catch (cause) { destroy(); throw cause; }
  };
  return Promise.race([consume(), aborted]);
}

function s3Storage(config: Extract<MediaStorageConfig, { mode: 's3' }>, dependencies: MediaStorageDependencies): MediaStorage {
  const client = dependencies.s3Client || new S3Client({ endpoint: config.endpoint, region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true, maxAttempts: 2, requestHandler: { connectionTimeout: 5_000, requestTimeout: REQUEST_TIMEOUT_MS },
  }) as unknown as S3ClientLike;
  return {
    mode: 's3',
    async putMedia(filename, body, privateFile = false) {
      const objectKey = key(filename, privateFile); assertBody(body);
      try {
        // Provision the bucket as PRIVATE in Neon. Do not grant public ACLs:
        // even product images are read through this application's public route.
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, Body: body,
          ContentType: contentType(filename), ContentLength: body.byteLength, IfNoneMatch: '*',
        }), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (cause) {
        const metadata = record(record(cause).$metadata);
        if (metadata.httpStatusCode === 412 || record(cause).name === 'PreconditionFailed') {
          throw error(409, 'MEDIA_EXISTS', 'This image filename already exists.');
        }
        throw unavailable();
      }
    },
    async getMedia(filename, privateFile = false) {
      const objectKey = key(filename, privateFile);
      try {
        const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const response = record(await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }), { abortSignal: signal }));
        if (typeof response.ContentLength === 'number' && response.ContentLength > MEDIA_MAX_BYTES) {
          const body = record(response.Body);
          if (typeof body.destroy === 'function') body.destroy.call(response.Body);
          throw error(413, 'MEDIA_TOO_LARGE', 'The image exceeds the storage size limit.');
        }
        const body = await limitedBody(response.Body, signal);
        // Derive the header from our accepted extension, never remote metadata.
        return { body, contentType: contentType(filename) };
      } catch (cause) {
        if (cause instanceof MediaStorageError) throw cause;
        if (notFound(cause)) throw error(404, 'MEDIA_NOT_FOUND', 'Image not found.');
        throw unavailable();
      }
    },
    async deleteMedia(filename, privateFile = false) {
      const objectKey = key(filename, privateFile);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (cause) { if (!notFound(cause)) throw unavailable(); }
    },
  };
}

/** The injected client makes tests entirely offline; no client is used in local mode. */
export function createMediaStorage(env: Environment = process.env, dependencies: MediaStorageDependencies = {}): MediaStorage {
  const config = readMediaStorageConfig(env);
  return config.mode === 's3' ? s3Storage(config, dependencies) : localStorage(config);
}

// Configuration validation runs at startup, before an upload can be accepted.
export const mediaStorage = createMediaStorage();
export const storageRoot = path.resolve(process.env.UPLOAD_DIR || process.env.STORAGE_DIR || './storage');
export const putMedia = mediaStorage.putMedia.bind(mediaStorage);
export const getMedia = mediaStorage.getMedia.bind(mediaStorage);
export const deleteMedia = mediaStorage.deleteMedia.bind(mediaStorage);
