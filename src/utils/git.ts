/**
 * Git helpers for `chaperone check --since <ref>`.
 */

import { execCommand } from "./process";

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Files (relative to `cwd`) added, copied, modified or renamed since the merge base of
 * `ref` and HEAD, including uncommitted and untracked (not ignored) files.
 *
 * @throws {GitError} when `cwd` is not in a git repository or `ref` does not exist
 */
export async function changedFilesSince(cwd: string, ref: string): Promise<Set<string>> {
  const repository = await execCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (repository.exitCode !== 0) {
    throw new GitError(`--since needs a git repository, but ${cwd} is not inside one`);
  }

  const verified = await execCommand("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd });
  if (verified.exitCode !== 0) {
    throw new GitError(`--since: unknown git ref "${ref}"`);
  }

  const mergeBase = await execCommand("git", ["merge-base", ref, "HEAD"], { cwd });
  const base = mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : ref;

  const [diff, untracked] = await Promise.all([
    execCommand("git", ["diff", "--name-only", "--relative", "--diff-filter=ACMR", "-z", base], { cwd }),
    execCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd }),
  ]);
  if (diff.exitCode !== 0) {
    throw new GitError(`git diff failed: ${diff.stderr.trim()}`);
  }

  return new Set([...splitNul(diff.stdout), ...splitNul(untracked.stdout)]);
}
