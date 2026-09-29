---
"chaperone": patch
---

`chaperone check` writes its whole report through a pipe: the compiled binary lost everything past the first 64 KB when the reader was slower than the write, so `chaperone check --format json | jq` got half a document on a large report. The report now waits for the pipe to take it.
