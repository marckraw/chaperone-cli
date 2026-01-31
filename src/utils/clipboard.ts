/**
 * Clipboard utilities for copying text
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Copy text to clipboard
 * Works on macOS, Linux (with xclip), and Windows
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const os = platform();

  let command: string;
  let args: string[];

  switch (os) {
    case "darwin":
      command = "pbcopy";
      args = [];
      break;
    case "linux":
      command = "xclip";
      args = ["-selection", "clipboard"];
      break;
    case "win32":
      command = "clip";
      args = [];
      break;
    default:
      console.error(`Clipboard not supported on ${os}`);
      return false;
  }

  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });

    proc.stdin.write(text);
    proc.stdin.end();

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}
