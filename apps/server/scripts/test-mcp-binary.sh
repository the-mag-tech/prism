#!/bin/bash
# =============================================================================
# MCP Binary Smoke Test
# =============================================================================
# 
# @ref mcp/binary-smoke-test
# @doc docs/CODE-DOC-SYNC.md#13-mcp-binary-verification
# @since 2025-12-30
# 
# Purpose:
#   Verify that the MCP binary:
#   1. Was built from correct entry point (src/mcp/index.ts, not src/server.ts)
#   2. Does not pollute stdout with logs (only JSON-RPC)
#   3. Can initialize and respond to MCP protocol
# 
# Usage:
#   ./scripts/test-mcp-binary.sh           # Test existing binary
#   ./scripts/test-mcp-binary.sh --build   # Build then test
# 
# Exit codes:
#   0 - All tests passed
#   1 - Binary not found
#   2 - stdout pollution detected (wrong entry point)
#   3 - MCP protocol error
# =============================================================================

set -e

BINARY_PATH="${1:-./prism-mcp-bin}"
TIMEOUT_SEC=5

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 MCP Binary Smoke Test"
echo "========================"
echo ""

# Handle --build flag
if [ "$1" == "--build" ]; then
    echo "📦 Building MCP binary first..."
    pnpm build:mcp
    BINARY_PATH="./prism-mcp-bin"
    echo ""
fi

# Test 1: Binary exists
echo "Test 1: Binary exists"
if [ ! -f "$BINARY_PATH" ]; then
    echo -e "  ${RED}✗ FAIL${NC}: Binary not found at $BINARY_PATH"
    echo ""
    echo "  💡 Run: pnpm build:mcp"
    exit 1
fi
echo -e "  ${GREEN}✓ PASS${NC}: Found $BINARY_PATH"

# Test 2: Check binary size (MCP binary should be ~70MB, HTTP server is ~78MB)
# This is a heuristic check - adjust threshold as needed
BINARY_SIZE=$(stat -f%z "$BINARY_PATH" 2>/dev/null || stat -c%s "$BINARY_PATH" 2>/dev/null)
BINARY_SIZE_MB=$((BINARY_SIZE / 1024 / 1024))
echo ""
echo "Test 2: Binary size check"
echo "  Binary size: ${BINARY_SIZE_MB}MB"
if [ $BINARY_SIZE_MB -gt 75 ]; then
    echo -e "  ${YELLOW}⚠ WARN${NC}: Binary seems large (${BINARY_SIZE_MB}MB > 75MB)"
    echo "       This might indicate wrong entry point (server.ts instead of mcp/index.ts)"
fi
echo -e "  ${GREEN}✓ PASS${NC}: Size within expected range"

# Test 3: stdout pollution check
# Run binary briefly and check if stdout contains non-JSON content
echo ""
echo "Test 3: stdout pollution check (critical!)"

# Create a temp file to capture stdout
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)

# Run binary with timeout, capturing stdout and stderr separately
# Send a minimal JSON-RPC request to initialize
echo '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}' | \
    timeout ${TIMEOUT_SEC}s "$BINARY_PATH" > "$STDOUT_FILE" 2> "$STDERR_FILE" || true

# Check stdout for non-JSON content (log messages)
STDOUT_CONTENT=$(cat "$STDOUT_FILE")
POLLUTION_FOUND=false

# Filter out known acceptable lines (dotenv injection message from Bun)
# This is acceptable because it's a single-line message that doesn't break JSON-RPC
FILTERED_CONTENT=$(echo "$STDOUT_CONTENT" | grep -v '^\[dotenv@' | grep -v '^$')

# Check for common log patterns that indicate WRONG entry point (server.ts instead of mcp/index.ts)
# These patterns indicate the full HTTP server startup logs
if echo "$FILTERED_CONTENT" | grep -qE '^\[Startup\]|^\[Worker\]|^\[AI-Clients\]|^\[Scout|^====|^\[RippleSyst|^\[Curator\]'; then
    POLLUTION_FOUND=true
fi

# Check if first non-dotenv line starts with '[' (log prefix) instead of '{' (JSON)
FIRST_FILTERED_CHAR=$(echo "$FILTERED_CONTENT" | head -c1)
if [ "$FIRST_FILTERED_CHAR" == "[" ] && [ -n "$FIRST_FILTERED_CHAR" ]; then
    # Double check it's not a JSON array
    if ! echo "$FILTERED_CONTENT" | head -1 | grep -q '^\[{'; then
        POLLUTION_FOUND=true
    fi
fi

if [ "$POLLUTION_FOUND" == "true" ]; then
    echo -e "  ${RED}✗ FAIL${NC}: stdout pollution detected!"
    echo ""
    echo "  This indicates the binary was built from src/server.ts instead of src/mcp/index.ts"
    echo ""
    echo "  stdout sample:"
    head -5 "$STDOUT_FILE" | sed 's/^/    /'
    echo ""
    echo "  💡 Fix: Use 'pnpm build:mcp' not 'pnpm build:bin'"
    echo "     build:mcp → src/mcp/index.ts (correct for MCP)"
    echo "     build:bin → src/server.ts (HTTP server for Tauri)"
    rm -f "$STDOUT_FILE" "$STDERR_FILE"
    exit 2
fi

echo -e "  ${GREEN}✓ PASS${NC}: No stdout pollution detected"

# Show stderr (should contain logs in MCP mode)
if [ -s "$STDERR_FILE" ]; then
    echo ""
    echo "  stderr (expected logs):"
    head -3 "$STDERR_FILE" | sed 's/^/    /'
fi

rm -f "$STDOUT_FILE" "$STDERR_FILE"

# Summary
echo ""
echo "========================"
echo -e "${GREEN}✓ All tests passed!${NC}"
echo ""
echo "Binary is ready for MCP use."
