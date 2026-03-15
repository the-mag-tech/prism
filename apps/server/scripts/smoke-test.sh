#!/bin/bash
# Smoke Test for Prism Server Binary
# Verifies compiled binary can start and respond to health check
# Run after `bun build --compile` to catch runtime issues before release

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRISM_DIR="$(dirname "$SCRIPT_DIR")"
BINARY="${1:-$PRISM_DIR/prism-server-bin}"
TEST_PORT=19999
TEST_DB="/tmp/prism-smoke-test-$$.db"
TIMEOUT_SECONDS=10

echo "🧪 Prism Server Smoke Test"
echo "   Binary: $BINARY"
echo "   Port: $TEST_PORT"
echo "   DB: $TEST_DB"
echo ""

# Check binary exists
if [ ! -f "$BINARY" ]; then
    echo "❌ Binary not found: $BINARY"
    exit 1
fi

# Cleanup function
cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$TEST_DB" "$TEST_DB-shm" "$TEST_DB-wal"
}
trap cleanup EXIT

# Start server in background with isolated DB
echo "🚀 Starting server..."
DB_PATH="$TEST_DB" PORT="$TEST_PORT" "$BINARY" > /tmp/prism-smoke-stdout.log 2> /tmp/prism-smoke-stderr.log &
SERVER_PID=$!

# Wait for server to start (poll health endpoint)
echo "⏳ Waiting for server to respond..."
START_TIME=$(date +%s)
HEALTH_OK=false

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -gt $TIMEOUT_SECONDS ]; then
        echo "❌ Timeout: Server did not respond within ${TIMEOUT_SECONDS}s"
        echo ""
        echo "=== STDERR (last 30 lines) ==="
        tail -30 /tmp/prism-smoke-stderr.log
        exit 1
    fi
    
    # Check if process died
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "❌ Server process died!"
        echo ""
        echo "=== STDERR ==="
        cat /tmp/prism-smoke-stderr.log
        exit 1
    fi
    
    # Try health check
    HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$TEST_PORT/health" 2>/dev/null || echo "000")
    
    if [ "$HEALTH_RESPONSE" = "200" ]; then
        HEALTH_OK=true
        break
    fi
    
    sleep 0.5
done

if [ "$HEALTH_OK" = true ]; then
    echo "✅ Health check passed!"
    
    # Additional checks
    echo ""
    echo "🔍 Running additional checks..."
    
    # Check /health response body
    HEALTH_BODY=$(curl -s "http://127.0.0.1:$TEST_PORT/health")
    if echo "$HEALTH_BODY" | grep -q '"status":"ok"'; then
        echo "   ✓ Health response valid"
    else
        echo "   ⚠ Health response unexpected: $HEALTH_BODY"
    fi
    
    # Check database was created (server may use different path)
    ACTUAL_DB=$(find /tmp -name "prism-smoke-test-*.db" -mmin -1 2>/dev/null | head -1)
    if [ -n "$ACTUAL_DB" ] && [ -f "$ACTUAL_DB" ]; then
        echo "   ✓ Database created: $ACTUAL_DB"
        # Check migrations ran
        DB_VERSION=$(sqlite3 "$ACTUAL_DB" "SELECT version FROM migrations ORDER BY version DESC LIMIT 1" 2>/dev/null || echo "0")
        if [ "$DB_VERSION" -gt 0 ]; then
            echo "   ✓ Migrations applied (version: $DB_VERSION)"
        fi
    else
        echo "   ⚠ Database location not detected (non-blocking)"
    fi
    
    echo ""
    echo "🎉 Smoke test PASSED!"
    exit 0
else
    echo "❌ Smoke test FAILED!"
    exit 1
fi

