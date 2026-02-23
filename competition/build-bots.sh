#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SCRIPTS_DIR="${SCRIPT_DIR}/scripts"
FORKS_DIR="${SCRIPT_DIR}/forks"
BOTS_OUTPUT_DIR="${SCRIPT_DIR}/web/public/bots"
EMSDK_DIR="${SCRIPT_DIR}/emsdk"
MANIFEST_FILE="${BOTS_OUTPUT_DIR}/manifest.json"
REPO_OWNER="gameguild-gg"
REPO_NAME="chess-competition"
API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/forks"
TIME_LIMIT_MS=10000

# ---------- Colors ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}>>>${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}>>> WARNING:${NC} $*" >&2; }
err()   { echo -e "${RED}>>> ERROR:${NC} $*" >&2; }

# ---------- 1. Ensure Emscripten is available ----------
ensure_emscripten() {
    if command -v emcc &>/dev/null; then
        log "Emscripten already available: $(emcc --version | head -1)"
        return
    fi

    log "Emscripten not found, bootstrapping emsdk..."
    if [ ! -d "$EMSDK_DIR" ]; then
        git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
    else
        git -C "$EMSDK_DIR" pull
    fi

    "$EMSDK_DIR/emsdk" install latest
    "$EMSDK_DIR/emsdk" activate latest
    source "$EMSDK_DIR/emsdk_env.sh"

    # Remove Emscripten's fake SDL headers that conflict with our real SDL2
    find "$EMSDK_DIR" -path "*/fakesdl*" -type d -exec rm -rf {} + || true

    log "Emscripten ready: $(emcc --version | head -1)"
}

# ---------- 2. Fetch all forks from GitHub API ----------
fetch_forks() {
    local output_file="$1"
    log "Fetching forks of ${REPO_OWNER}/${REPO_NAME}..."

    local token_arg=""
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        token_arg="--token ${GITHUB_TOKEN}"
        log "Using authenticated GitHub API access"
    else
        warn "No GITHUB_TOKEN set — using unauthenticated API (60 req/hr limit)"
    fi

    python3 "${SCRIPTS_DIR}/fetch_forks.py" "$REPO_OWNER" "$REPO_NAME" "$output_file" $token_arg
}

# ---------- 3. Compile a single fork ----------
compile_fork() {
    local username="$1"
    local clone_url="$2"
    local fork_dir="${FORKS_DIR}/${username}"
    local build_dir="${fork_dir}/build-competition"

    log "Compiling bot for '${username}'..."

    # Clone or update
    if [ -d "$fork_dir" ]; then
        log "  Updating existing clone..."
        git -C "$fork_dir" fetch --depth=1 origin 2>/dev/null || true
        git -C "$fork_dir" reset --hard origin/HEAD 2>/dev/null || \
            git -C "$fork_dir" reset --hard origin/master 2>/dev/null || \
            git -C "$fork_dir" reset --hard origin/main 2>/dev/null || true
    else
        log "  Cloning ${clone_url}..."
        git clone --depth=1 "$clone_url" "$fork_dir" 2>/dev/null || {
            err "  Failed to clone ${clone_url}"
            return 1
        }
    fi

    # Validate: must have chess-bot/chess-simulator.h
    if [ ! -f "${fork_dir}/chess-bot/chess-simulator.h" ]; then
        warn "  No chess-bot/chess-simulator.h found, skipping"
        return 1
    fi

    # Copy upstream bindings.cpp (handles old forks without it or with old versions)
    mkdir -p "${fork_dir}/chess-wasm"
    cp "${PROJECT_DIR}/chess-wasm/bindings.cpp" "${fork_dir}/chess-wasm/bindings.cpp"

    # Also ensure cmake/ directory has get_cpm.cmake
    mkdir -p "${fork_dir}/cmake"
    cp "${PROJECT_DIR}/cmake/get_cpm.cmake" "${fork_dir}/cmake/get_cpm.cmake"

    # Copy the upstream CMakeLists.txt (ensures CHESS_COMPETITION flag is available)
    cp "${PROJECT_DIR}/CMakeLists.txt" "${fork_dir}/CMakeLists.txt"

    # Configure
    rm -rf "$build_dir"
    mkdir -p "$build_dir"

    log "  Configuring CMake..."
    if ! emcmake cmake \
        -S "$fork_dir" \
        -B "$build_dir" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCHESS_COMPETITION=ON \
        -DCHESS_BOT_NAME="${username}" \
        2>&1 | tail -5; then
        err "  CMake configure failed for '${username}'"
        return 1
    fi

    # Build
    log "  Building..."
    if ! cmake --build "$build_dir" --target "${username}" --parallel 2>&1 | tail -5; then
        err "  Build failed for '${username}'"
        return 1
    fi

    # Copy outputs
    if [ -f "${build_dir}/${username}.js" ] && [ -f "${build_dir}/${username}.wasm" ]; then
        cp "${build_dir}/${username}.js" "${BOTS_OUTPUT_DIR}/"
        cp "${build_dir}/${username}.wasm" "${BOTS_OUTPUT_DIR}/"
        log "  Success: ${username}.js + ${username}.wasm"
        return 0
    else
        err "  Output files not found for '${username}'"
        return 1
    fi
}

# ---------- Main ----------
main() {
    ensure_emscripten

    mkdir -p "$FORKS_DIR"
    mkdir -p "$BOTS_OUTPUT_DIR"

    # Fetch forks into a temp file
    local forks_file
    forks_file=$(mktemp)
    fetch_forks "$forks_file"

    # Parse fork data into arrays
    local usernames=()
    local clone_urls=()
    local avatar_urls=()
    local html_urls=()

    while IFS='|' read -r uname curl aurl hurl; do
        usernames+=("$uname")
        clone_urls+=("$curl")
        avatar_urls+=("$aurl")
        html_urls+=("$hurl")
    done < <(python3 "${SCRIPTS_DIR}/parse_forks.py" "$forks_file")
    rm -f "$forks_file"

    local total=${#usernames[@]}
    log "Processing ${total} forks..."

    # Build manifest using a temp file
    local manifest_tmp
    manifest_tmp=$(mktemp)
    echo "[]" > "$manifest_tmp"
    local success_count=0
    local fail_count=0

    for i in $(seq 0 $((total - 1))); do
        local username="${usernames[$i]}"
        local clone_url="${clone_urls[$i]}"
        local avatar_url="${avatar_urls[$i]}"
        local html_url="${html_urls[$i]}"

        if [ -z "$username" ]; then
            continue
        fi

        echo "" >&2
        log "=== [$(( i + 1 ))/${total}] ${username} ==="

        if compile_fork "$username" "$clone_url"; then
            python3 "${SCRIPTS_DIR}/manifest.py" add "$manifest_tmp" "$username" "$avatar_url" "$html_url"
            success_count=$((success_count + 1))
        else
            warn "Skipping '${username}' due to errors"
            fail_count=$((fail_count + 1))
        fi
    done

    # Write final pretty-printed manifest
    python3 "${SCRIPTS_DIR}/manifest.py" format "$manifest_tmp" "$MANIFEST_FILE"
    rm -f "$manifest_tmp"

    echo "" >&2
    log "========================================="
    log "Competition build complete!"
    log "  Successful: ${success_count}"
    log "  Failed:     ${fail_count}"
    log "  Manifest:   ${MANIFEST_FILE}"
    log "  Bots dir:   ${BOTS_OUTPUT_DIR}"
    log "========================================="
}

main "$@"
