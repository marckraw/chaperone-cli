/**
 * Terminal spinner for showing progress.
 *
 * The spinner writes to stderr by default so it never pollutes machine-readable
 * output on stdout, and it is a no-op unless explicitly enabled (the CLI enables it
 * only for text output on an interactive terminal).
 */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

export interface Spinner {
  start: (text?: string) => void;
  update: (text: string) => void;
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
  /** Print a line above the spinner (it keeps spinning) */
  log: (line: string) => void;
  stop: () => void;
}

export interface SpinnerOptions {
  /** Where to draw (default: process.stderr) */
  stream?: { write(chunk: string): unknown };
  /** When false every method is a no-op (default: false) */
  enabled?: boolean;
}

/**
 * Create a terminal spinner
 */
export function createSpinner(initialText = "", options: SpinnerOptions = {}): Spinner {
  const { stream = process.stderr, enabled = false } = options;

  if (!enabled) {
    const noop = () => {};
    return { start: noop, update: noop, succeed: noop, fail: noop, log: noop, stop: noop };
  }

  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentText = initialText;
  let active = false;

  const clearLine = () => {
    stream.write("\r\x1b[K");
  };

  const render = () => {
    if (!active) return;
    const frame = SPINNER_FRAMES[frameIndex] ?? "";
    clearLine();
    stream.write(`\x1b[36m${frame}\x1b[0m ${currentText}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  const stop = () => {
    if (!active) return;
    active = false;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    clearLine();
    // Show cursor
    stream.write("\x1b[?25h");
  };

  return {
    start(text?: string) {
      if (text) currentText = text;
      if (active) return;
      active = true;
      // Hide cursor
      stream.write("\x1b[?25l");
      render();
      interval = setInterval(render, SPINNER_INTERVAL);
    },

    update(text: string) {
      currentText = text;
    },

    succeed(text?: string) {
      stop();
      stream.write(`\x1b[32m✓\x1b[0m ${text ?? currentText}\n`);
    },

    fail(text?: string) {
      stop();
      stream.write(`\x1b[31m✗\x1b[0m ${text ?? currentText}\n`);
    },

    log(line: string) {
      const wasActive = active;
      if (wasActive) clearLine();
      stream.write(`${line}\n`);
      if (wasActive) render();
    },

    stop,
  };
}
