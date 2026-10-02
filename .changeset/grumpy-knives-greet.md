---
"chaperone": patch
---

A machine default: the Chaperone version a machine runs where nothing pins one. It lets the installed `chaperone` become the launcher while repositories that do not pin a version keep running the version they run today.

- The default comes from `CHAPERONE_DEFAULT_VERSION` when it is set, otherwise from `"defaultVersion"` in `~/.config/chaperone/config.json` (`$XDG_CONFIG_HOME/chaperone/config.json`, or `%APPDATA%\chaperone\config.json` on Windows). A repository's own `chaperoneVersion` always wins.
- The launcher treats the default exactly like a pin: the same cache, the same check against the release's `SHA256SUMS.txt`, the same recursion guard, and never another version in its place. An invalid default stops the run with exit code 2 and says where it came from (`"error": "invalid-machine-default"` with `check --format json`).
- `chaperone default <version>` downloads and verifies the version, then writes it, keeping the file's other fields; `chaperone default` shows the default and where it comes from; `chaperone default --clear` removes it.
- `chaperone --version` names the source: `chaperone v0.7.1 (machine default in ~/.config/chaperone/config.json, launched by v0.10.1)`.
- `CHAPERONE_IGNORE_PIN=1` ignores the machine default too. Where the default chose the version that runs, the hint to pin says so, and the update notice says `chaperone default <latest>` rather than pointing at a download.

MIGRATION.md has the exact steps for a machine with many unpinned repositories: set the default first, with the new binary from a temporary directory, then install the launcher.
