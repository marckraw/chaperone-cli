---
"chaperone": minor
---

Every repository can pin the Chaperone it runs, with `"chaperoneVersion": "0.10.0"` in `.chaperone.json`, and the `chaperone` you install is now a launcher:

- When the pin names another version, the launcher runs that version instead, with the same arguments, stdio and environment, and passes its exit code and signals through. It downloads the release binary for the platform once, checks it against the release's `SHA256SUMS.txt`, and keeps it in `~/.cache/chaperone/<version>/` (`CHAPERONE_CACHE_DIR` and `XDG_CACHE_HOME` are honoured), installed atomically so parallel runs cannot corrupt it. Offline it uses the cache; with no cached copy, a checksum that does not match, or a cached binary that cannot be run, the run fails with exit code 2 and says what to do. It never runs another version in the pinned one's place.
- Pins of versions that predate the launcher (0.9.0 and older) work: they are run as they are.
- The pin must be an exact version (`v0.10.0` is read as `0.10.0`). A range, `latest`, a misspelled field name or a pin in a preset is an error, with a suggestion where one fits.
- `chaperone pin [version]` writes the pin (downloading and verifying another version first), `chaperone cache` lists and clears downloaded versions, and `chaperone --version` names the version that runs in the repository, then the launcher's. `chaperone init` pins new configs.
- Without a pin, a text report on a terminal ends with a one-line tip to pin; JSON, AI and `--quiet` output, and output to pipes, never show it.
- `install.sh --version pinned` (or `CHAPERONE_VERSION=pinned`) installs the version a repository pins, for a one-line CI install. Outside CI it refuses a pin older than 0.10, which has no launcher and would run in every repository on the machine. `CHAPERONE_RELEASES_URL` points the launcher and the install script at a mirror.

MIGRATION.md explains how to move to 0.10, including replacing a repository's own wrapper script once the pinned version demonstrably runs in its place.
