# Changesets

This folder stores release notes and semver intent for `chaperone`.

## Workflow

1. Add a changeset in feature PRs:
   - `bun run changeset`
2. Merge PRs to `master`.
3. The Changesets GitHub Action opens/updates a version PR.
4. Merge the version PR.
5. Release workflow builds Bun binaries and publishes a GitHub Release.
