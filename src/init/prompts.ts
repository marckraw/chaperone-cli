/**
 * Interactive prompts for Chaperone init
 */

import * as readline from "node:readline";

/**
 * Create a readline interface for prompts
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a yes/no confirmation question
 */
export async function confirm(question: string, defaultValue: boolean = true): Promise<boolean> {
  const rl = createReadlineInterface();
  const defaultHint = defaultValue ? "Y/n" : "y/N";

  return new Promise((resolve) => {
    rl.question(`${question} [${defaultHint}]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      if (trimmed === "") {
        resolve(defaultValue);
      } else if (trimmed === "y" || trimmed === "yes") {
        resolve(true);
      } else if (trimmed === "n" || trimmed === "no") {
        resolve(false);
      } else {
        resolve(defaultValue);
      }
    });
  });
}

/**
 * Ask for text input with optional default
 */
export async function input(question: string, defaultValue: string = ""): Promise<string> {
  const rl = createReadlineInterface();
  const defaultHint = defaultValue ? ` [${defaultValue}]` : "";

  return new Promise((resolve) => {
    rl.question(`${question}${defaultHint}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === "" ? defaultValue : trimmed);
    });
  });
}

/**
 * Ask for a list of values (comma-separated)
 */
export async function inputList(question: string, defaultValue: string[] = []): Promise<string[]> {
  const rl = createReadlineInterface();
  const defaultHint = defaultValue.length > 0 ? ` [${defaultValue.join(", ")}]` : "";

  return new Promise((resolve) => {
    rl.question(`${question}${defaultHint}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();

      if (trimmed === "") {
        resolve(defaultValue);
      } else {
        resolve(trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0));
      }
    });
  });
}
