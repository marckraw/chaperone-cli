/**
 * Launcher errors. Kept apart from the download code (install.ts), which is loaded only when a
 * version has to be downloaded.
 */

/** A problem the user has to act on. Its message is printed as is, and the run exits with 2. */
export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchError";
  }
}

/** The network failed: no connection, a stalled download or an error status. Retrying may help. */
export class NetworkError extends LaunchError {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}
