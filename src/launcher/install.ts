/**
 * Downloading a pinned version into the cache: verified against the release's SHA256SUMS.txt and
 * installed atomically.
 *
 * Each run downloads into its own temporary file next to the final path and renames it into
 * place only after the checksum matches. A rename within one directory is atomic, so a reader
 * sees either no binary or a complete, verified one; two runs at once each write their own
 * temporary file, and the second rename replaces the first with identical bytes.
 *
 * Loaded only when a version has to be downloaded (node:crypto alone costs ~5 ms at startup).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { LaunchError, NetworkError } from "./errors";
import { CHECKSUMS_FILE, findChecksum, releaseFileUrl } from "./paths";

export interface InstallOptions {
  version: string;
  asset: string;
  /** Final path: `<cache>/<version>/<asset>` */
  binaryPath: string;
  releasesUrl: string;
  /** Progress lines (stderr) */
  log: (line: string) => void;
  /** Abort a download that receives nothing for this long (default 30 s) */
  stallTimeoutMs?: number;
}

const STALE_PARTIAL_MS = 60 * 60 * 1000;

/** Temporary files are `.<asset>.<pid>-<random>.partial`, next to the binary. */
export function isPartialFile(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".partial");
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error && cause.message !== error.message ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}

/** A response with an error status (404 for a release that does not exist). */
class HttpError extends NetworkError {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * fetch with a stall timeout: the request fails when no response, or no data, arrives for
 * `stallTimeoutMs`. `onChunk` receives the body.
 */
async function download(url: string, stallTimeoutMs: number, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`nothing received for ${Math.round(stallTimeoutMs / 1000)} s`)),
      stallTimeoutMs
    );
  };

  arm();
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } catch (error) {
      throw new NetworkError(`GET ${url} failed: ${describe(controller.signal.reason ?? error)}`);
    }
    if (!response.ok || !response.body) {
      const reason = response.status === 404 ? "404 Not Found" : `HTTP ${response.status}`;
      throw new HttpError(url, response.status, `GET ${url} returned ${reason}`);
    }
    try {
      for await (const chunk of response.body) {
        arm();
        onChunk(chunk);
      }
    } catch (error) {
      if (error instanceof LaunchError) throw error;
      throw new NetworkError(`downloading ${url} failed: ${describe(controller.signal.reason ?? error)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function downloadText(url: string, stallTimeoutMs: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  await download(url, stallTimeoutMs, (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

function writeAll(fd: number, chunk: Uint8Array): void {
  let offset = 0;
  while (offset < chunk.length) {
    offset += writeSync(fd, chunk, offset, chunk.length - offset);
  }
}

/** Remove temporary files that an interrupted download left behind more than an hour ago. */
function removeStalePartials(directory: string): void {
  try {
    for (const name of readdirSync(directory)) {
      if (!isPartialFile(name)) continue;
      const path = join(directory, name);
      if (Date.now() - statSync(path).mtimeMs > STALE_PARTIAL_MS) unlinkSync(path);
    }
  } catch {
    // Best effort: a leftover file costs disk space, not correctness.
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Download `asset` for `version`, check it against the release's SHA256SUMS.txt and install it at
 * `binaryPath`. Returns `binaryPath`.
 *
 * @throws {LaunchError} when the release, its checksum entry or the network is missing, or the
 * checksum does not match (nothing is installed then)
 */
export async function installRelease(options: InstallOptions): Promise<string> {
  const { version, asset, binaryPath, releasesUrl, log } = options;
  const stallTimeoutMs = options.stallTimeoutMs ?? 30_000;
  const sumsUrl = releaseFileUrl(releasesUrl, version, CHECKSUMS_FILE);
  const assetUrl = releaseFileUrl(releasesUrl, version, asset);

  log(`downloading Chaperone ${version} (${asset}) from ${dirname(assetUrl)}/`);

  let sums: string;
  try {
    sums = await downloadText(sumsUrl, stallTimeoutMs);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new LaunchError(
        `Chaperone ${version} has no release to download (${sumsUrl} returned 404 Not Found). ` +
          "Check the version: every release is listed at https://github.com/marckraw/chaperone-cli/releases"
      );
    }
    throw error;
  }

  const expected = findChecksum(sums, asset);
  if (!expected) {
    throw new LaunchError(`${CHECKSUMS_FILE} of Chaperone ${version} has no entry for ${asset}, so it cannot be verified`);
  }

  const directory = dirname(binaryPath);
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    throw new LaunchError(`cannot create the cache directory ${directory}: ${describe(error)}`);
  }
  removeStalePartials(directory);

  const partial = join(directory, `.${basename(binaryPath)}.${process.pid}-${randomBytes(4).toString("hex")}.partial`);
  const hash = createHash("sha256");
  let bytes = 0;
  let fd: number | null = null;

  try {
    try {
      fd = openSync(partial, "wx", 0o755);
    } catch (error) {
      throw new LaunchError(`cannot write to the cache directory ${directory}: ${describe(error)}`);
    }
    const handle = fd;
    await download(assetUrl, stallTimeoutMs, (chunk) => {
      hash.update(chunk);
      try {
        writeAll(handle, chunk);
      } catch (error) {
        // A full disk is not a network problem: say so, rather than "run again once it is reachable".
        throw new LaunchError(`cannot write the download to ${directory}: ${describe(error)}`);
      }
      bytes += chunk.length;
    });
    try {
      fsyncSync(handle);
    } catch (error) {
      throw new LaunchError(`cannot write the download to ${directory}: ${describe(error)}`);
    }
    closeSync(handle);
    fd = null;

    const actual = hash.digest("hex");
    if (actual !== expected) {
      throw new LaunchError(
        `refused ${asset} for Chaperone ${version}: its SHA-256 ${actual} does not match ${CHECKSUMS_FILE} (${expected}). ` +
          "It was not installed. Try again; if it keeps happening, report it at https://github.com/marckraw/chaperone-cli/issues"
      );
    }

    chmodSync(partial, 0o755);
    try {
      renameSync(partial, binaryPath);
    } catch (error) {
      // Windows cannot replace a binary that another run is executing: that one is verified too.
      if (!existsSync(binaryPath)) throw new LaunchError(`cannot install ${binaryPath}: ${describe(error)}`);
    }
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(partial)) {
      try {
        unlinkSync(partial);
      } catch {}
    }
  }

  log(`verified ${asset} ${version} (${formatMegabytes(bytes)}) against ${CHECKSUMS_FILE}; cached in ${directory}`);
  return binaryPath;
}
