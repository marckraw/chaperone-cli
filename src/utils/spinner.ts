/**
 * Terminal spinner for showing progress
 */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

export interface Spinner {
  start: (text?: string) => void;
  update: (text: string) => void;
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
  stop: () => void;
}

/**
 * Create a terminal spinner
 */
export function createSpinner(initialText = ""): Spinner {
  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentText = initialText;
  let isSpinning = false;

  const clearLine = () => {
    process.stdout.write("\r\x1b[K");
  };

  const render = () => {
    if (!isSpinning) return;
    const frame = SPINNER_FRAMES[frameIndex];
    clearLine();
    process.stdout.write(`\x1b[36m${frame}\x1b[0m ${currentText}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  return {
    start(text?: string) {
      if (text) currentText = text;
      isSpinning = true;
      // Hide cursor
      process.stdout.write("\x1b[?25l");
      render();
      interval = setInterval(render, SPINNER_INTERVAL);
    },

    update(text: string) {
      currentText = text;
    },

    succeed(text?: string) {
      this.stop();
      const finalText = text ?? currentText;
      console.log(`\x1b[32m✓\x1b[0m ${finalText}`);
    },

    fail(text?: string) {
      this.stop();
      const finalText = text ?? currentText;
      console.log(`\x1b[31m✗\x1b[0m ${finalText}`);
    },

    stop() {
      isSpinning = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      clearLine();
      // Show cursor
      process.stdout.write("\x1b[?25h");
    },
  };
}

/**
 * Simple progress indicator for multiple steps
 */
export interface ProgressStep {
  name: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
}

export function createProgress(steps: string[]): {
  start: (stepIndex: number) => void;
  complete: (stepIndex: number, skipped?: boolean) => void;
  error: (stepIndex: number) => void;
  finish: () => void;
} {
  const stepStates: ProgressStep[] = steps.map((name) => ({
    name,
    status: "pending",
  }));

  const spinner = createSpinner();

  const getStatusIcon = (status: ProgressStep["status"]) => {
    switch (status) {
      case "running":
        return "\x1b[36m⠋\x1b[0m";
      case "done":
        return "\x1b[32m✓\x1b[0m";
      case "skipped":
        return "\x1b[33m○\x1b[0m";
      case "error":
        return "\x1b[31m✗\x1b[0m";
      default:
        return "\x1b[2m○\x1b[0m";
    }
  };

  return {
    start(stepIndex: number) {
      stepStates[stepIndex].status = "running";
      spinner.start(stepStates[stepIndex].name);
    },

    complete(stepIndex: number, skipped = false) {
      stepStates[stepIndex].status = skipped ? "skipped" : "done";
      const icon = getStatusIcon(stepStates[stepIndex].status);
      spinner.stop();
      const suffix = skipped ? " \x1b[2m(skipped)\x1b[0m" : "";
      console.log(`${icon} ${stepStates[stepIndex].name}${suffix}`);
    },

    error(stepIndex: number) {
      stepStates[stepIndex].status = "error";
      spinner.fail(stepStates[stepIndex].name);
    },

    finish() {
      spinner.stop();
    },
  };
}
