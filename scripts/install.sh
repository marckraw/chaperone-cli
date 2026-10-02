#!/usr/bin/env sh
set -eu

REPO="${CHAPERONE_REPO:-marckraw/chaperone-cli}"
VERSION="${CHAPERONE_VERSION:-latest}"
INSTALL_DIR="${CHAPERONE_INSTALL_DIR:-/usr/local/bin}"
CONFIG="${CHAPERONE_CONFIG:-.chaperone.json}"
RELEASES_URL="${CHAPERONE_RELEASES_URL:-}"

usage() {
  cat <<EOF
Install chaperone from GitHub Releases.

Usage:
  install.sh [--version <version|latest|pinned>] [--config <path>]
             [--install-dir <dir>] [--repo <owner/repo>]

  --version pinned   Install the version the project pins: "chaperoneVersion"
                     in .chaperone.json (or the file given with --config).
                     Meant for CI: the job then runs exactly the pinned version.
                     A pin older than 0.10 (which has no launcher) is installed
                     only when CI is set: as a workstation's chaperone it would
                     run that version in every repository.

Examples:
  sh install.sh
  sh install.sh --version 0.3.0
  sh install.sh --version pinned
  sh install.sh --install-dir "\$HOME/.local/bin"

Environment variables:
  CHAPERONE_VERSION       a version, "latest" (default) or "pinned"
  CHAPERONE_CONFIG        the config "pinned" reads (default: .chaperone.json)
  CHAPERONE_INSTALL_DIR
  CHAPERONE_REPO
  CHAPERONE_RELEASES_URL  download from a mirror laid out as <url>/v<version>/<file>
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --config)
      CONFIG="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "${VERSION}" ] || [ -z "${INSTALL_DIR}" ] || [ -z "${REPO}" ]; then
  echo "version, install-dir, and repo must be non-empty." >&2
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd curl

UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"

case "${UNAME_S}" in
  Darwin) OS="darwin" ;;
  Linux) OS="linux" ;;
  *)
    echo "Unsupported OS: ${UNAME_S}" >&2
    exit 1
    ;;
esac

case "${UNAME_M}" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: ${UNAME_M}" >&2
    exit 1
    ;;
esac

PINNED_FROM=""
if [ "${VERSION}" = "pinned" ]; then
  # The pin is "chaperoneVersion": "<version>" in the project's config (plain JSON). The lines are
  # joined first, so the key and its value may sit on different lines.
  if [ ! -f "${CONFIG}" ]; then
    echo "Cannot install the pinned version: ${CONFIG} not found." >&2
    echo "Run this from the project root, or pass --config <path>." >&2
    exit 1
  fi
  FLAT="$(tr '\n\r' '  ' < "${CONFIG}")"
  KEYS="$(printf '%s\n' "${FLAT}" | grep -o '"chaperoneVersion"[[:space:]]*:' | wc -l | tr -d ' ')"
  if [ "${KEYS}" -gt 1 ]; then
    echo "Cannot install the pinned version: ${CONFIG} has ${KEYS} \"chaperoneVersion\" keys." >&2
    echo "The pin is the one at the top level of the file; remove the others." >&2
    exit 1
  fi
  PINNED="$(printf '%s\n' "${FLAT}" | sed -n 's/.*"chaperoneVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "${PINNED}" ]; then
    echo "Cannot install the pinned version: ${CONFIG} has no \"chaperoneVersion\"." >&2
    echo "Pin one with \"chaperone pin\", or install a version with --version <version>." >&2
    exit 1
  fi
  # The launcher's rule: MAJOR.MINOR.PATCH, an optional pre-release, an optional leading v.
  if ! printf '%s\n' "${PINNED}" | grep -Eq '^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'; then
    echo "Cannot install the pinned version: \"chaperoneVersion\" in ${CONFIG} is \"${PINNED}\", not an exact version such as \"0.10.0\"." >&2
    exit 1
  fi

  # Versions before 0.10 have no launcher. Installed as a machine's chaperone, one runs that version
  # in every repository, whatever each pins. A CI job's machine is thrown away; a workstation is not.
  BARE="${PINNED#v}"
  MAJOR="${BARE%%.*}"
  MINOR="${BARE#*.}"
  MINOR="${MINOR%%.*}"
  if [ "${MAJOR}" -eq 0 ] && [ "${MINOR}" -lt 10 ]; then
    case "${CI:-}" in
      ""|0|false|FALSE|False)
        echo "Not installing chaperone ${PINNED}: it predates version pinning, so as this machine's chaperone it" >&2
        echo "would run ${PINNED} in every repository, whatever each one pins." >&2
        echo "Install the launcher instead (sh install.sh, no version): it runs ${PINNED} here, and each other" >&2
        echo "repository's own pin there. In CI (CI is set) the pinned version is installed as it is." >&2
        echo "To install ${PINNED} here anyway: --version ${PINNED}" >&2
        exit 1
        ;;
    esac
    echo "Note: chaperone ${PINNED} predates version pinning. Fine for this CI job; on a runner that other"
    echo "repositories share, it would run ${PINNED} for them too."
  fi

  VERSION="${PINNED}"
  PINNED_FROM=" (pinned in ${CONFIG})"
fi

if [ "${VERSION}" = "latest" ]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [ -z "${TAG}" ]; then
    echo "Failed to resolve latest release tag for ${REPO}." >&2
    exit 1
  fi
else
  case "${VERSION}" in
    v*) TAG="${VERSION}" ;;
    *) TAG="v${VERSION}" ;;
  esac
fi

if [ -n "${RELEASES_URL}" ]; then
  BASE_URL="${RELEASES_URL%/}/${TAG}"
else
  BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
fi
ASSET="chaperone-${OS}-${ARCH}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT INT TERM

echo "Installing chaperone ${TAG}${PINNED_FROM} from ${BASE_URL}..."
echo "Detected target: ${OS}-${ARCH}"

CHECKSUMS_PATH="${TMP_DIR}/SHA256SUMS.txt"
ASSET_PATH="${TMP_DIR}/${ASSET}"

curl -fsSL "${BASE_URL}/SHA256SUMS.txt" -o "${CHECKSUMS_PATH}"
curl -fsSL "${BASE_URL}/${ASSET}" -o "${ASSET_PATH}"

EXPECTED_SHA="$(grep " ${ASSET}\$" "${CHECKSUMS_PATH}" | awk '{print $1}' | head -n1)"
if [ -z "${EXPECTED_SHA}" ]; then
  echo "Could not find checksum entry for ${ASSET} in SHA256SUMS.txt" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "${ASSET_PATH}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "${ASSET_PATH}" | awk '{print $1}')"
elif command -v openssl >/dev/null 2>&1; then
  ACTUAL_SHA="$(openssl dgst -sha256 "${ASSET_PATH}" | awk '{print $NF}')"
else
  echo "Missing checksum tool (shasum, sha256sum, or openssl)." >&2
  exit 1
fi

if [ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]; then
  echo "Checksum mismatch for ${ASSET}" >&2
  echo "Expected: ${EXPECTED_SHA}" >&2
  echo "Actual:   ${ACTUAL_SHA}" >&2
  exit 1
fi

if [ ! -f "${ASSET_PATH}" ]; then
  echo "Downloaded asset not found: ${ASSET_PATH}" >&2
  exit 1
fi

if [ ! -w "${INSTALL_DIR}" ]; then
  FALLBACK_DIR="${HOME}/.local/bin"
  echo "Install directory not writable: ${INSTALL_DIR}"
  echo "Falling back to ${FALLBACK_DIR}"
  INSTALL_DIR="${FALLBACK_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
install -m 0755 "${ASSET_PATH}" "${INSTALL_DIR}/chaperone"

echo "Installed to ${INSTALL_DIR}/chaperone"
echo "Run: chaperone --help"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo "Note: ${INSTALL_DIR} is not in PATH."
    echo "Add it, for example:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac
