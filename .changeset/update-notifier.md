---
"chaperone": minor
---

Add CLI update notification that checks GitHub Releases for newer versions. Uses a background cache pattern with zero added latency — reads cached data on startup, prints a notice to stderr after command output, and refreshes the cache asynchronously. Also fixes version.ts to read from package.json as single source of truth.
