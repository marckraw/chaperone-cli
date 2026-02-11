#!/usr/bin/env sh
set -eu

REPO="${CHAPERONE_REPO:-marckraw/chaperone}"
VERSION="${CHAPERONE_VERSION:-latest}"
INSTALL_DIR="${CHAPERONE_INSTALL_DIR:-/usr/local/bin}"

usage() {
  cat <<EOF
Install chaperone from GitHub Releases.

Usage:
  install.sh [--version <version>] [--install-dir <dir>] [--repo <owner/repo>]

Examples:
  sh install.sh
  sh install.sh --version 0.3.0
  sh install.sh --install-dir "\$HOME/.local/bin"

Environment variables:
  CHAPERONE_VERSION
  CHAPERONE_INSTALL_DIR
  CHAPERONE_REPO
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
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

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
ASSET="chaperone-${OS}-${ARCH}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT INT TERM

echo "Installing chaperone from ${REPO} ${TAG}..."
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
