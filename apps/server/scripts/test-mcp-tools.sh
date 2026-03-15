#!/bin/bash
#
# MCP Tools Test Pipeline
#
# Usage:
#   ./scripts/test-mcp-tools.sh [--build] [--query="your query"]
#
# Examples:
#   ./scripts/test-mcp-tools.sh
#   ./scripts/test-mcp-tools.sh --build
#   ./scripts/test-mcp-tools.sh --query="AI memory management"
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MCP_BIN="$PROJECT_DIR/prism-mcp-bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Parse args
BUILD=false
QUERY="just-in-time context AI agent"

for arg in "$@"; do
  case $arg in
    --build)
      BUILD=true
      ;;
    --query=*)
      QUERY="${arg#*=}"
      ;;
  esac
done

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  MCP Tools Test Pipeline${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

# Step 0: Kill existing processes
echo -e "${DIM}Stopping any existing prism processes...${NC}"
pkill -f "prism-mcp-bin" 2>/dev/null || true
pkill -f "prism-server" 2>/dev/null || true
sleep 1

# Step 1: Build (optional)
if [ "$BUILD" = true ]; then
  echo ""
  echo -e "${CYAN}Step 1: Building MCP Binary${NC}"
  cd "$PROJECT_DIR"
  pnpm build:mcp
  echo -e "${GREEN}✅ Build successful${NC}"
else
  echo -e "${DIM}Skipping build (use --build to rebuild)${NC}"
fi

# Step 2: Test tools/list
echo ""
echo -e "${CYAN}Step 2: Testing tools/list${NC}"

TOOLS_OUTPUT=$(timeout 30 bash -c "echo '{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\"}' | '$MCP_BIN' 2>&1" || true)

# Extract JSON line
TOOLS_JSON=$(echo "$TOOLS_OUTPUT" | grep -o '{"result":{"tools":\[.*\]},"jsonrpc":"2.0","id":1}' || true)

if [ -z "$TOOLS_JSON" ]; then
  echo -e "${RED}❌ Failed to get tools list${NC}"
  echo -e "${DIM}Output:${NC}"
  echo "$TOOLS_OUTPUT" | head -20
  exit 1
fi

# Count tools
TOOL_COUNT=$(echo "$TOOLS_JSON" | jq '.result.tools | length')
echo -e "${GREEN}✅ Found $TOOL_COUNT tools${NC}"

# List tools
echo "$TOOLS_JSON" | jq -r '.result.tools[].name' | while read tool; do
  if [ "$tool" = "prism_search" ]; then
    echo -e "   ${GREEN}→ $tool${NC}"
  else
    echo "     $tool"
  fi
done

# Check for prism_search
HAS_SEARCH=$(echo "$TOOLS_JSON" | jq '.result.tools[] | select(.name=="prism_search")' | wc -l)
if [ "$HAS_SEARCH" -eq 0 ]; then
  echo -e "${YELLOW}⚠️ prism_search not found! Run with --build${NC}"
  exit 1
fi

# Step 3: Test prism_search
echo ""
echo -e "${CYAN}Step 3: Testing prism_search${NC}"
echo -e "${DIM}Query: $QUERY${NC}"

SEARCH_REQUEST=$(cat <<EOF
{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "prism_search", "arguments": {"query": "$QUERY", "maxResults": 3, "includeAnswer": true}}}
EOF
)

SEARCH_OUTPUT=$(timeout 60 bash -c "echo '$SEARCH_REQUEST' | '$MCP_BIN' 2>&1" || true)

# Extract JSON response
SEARCH_JSON=$(echo "$SEARCH_OUTPUT" | grep -o '{"result":{"content":\[.*\]},"jsonrpc":"2.0","id":2}' || true)

if [ -z "$SEARCH_JSON" ]; then
  echo -e "${RED}❌ Failed to get search results${NC}"
  echo -e "${DIM}Looking for response in output...${NC}"
  echo "$SEARCH_OUTPUT" | grep -E "(prism_search|Found|results)" | head -10
  exit 1
fi

# Parse and display results
INNER_JSON=$(echo "$SEARCH_JSON" | jq -r '.result.content[0].text')
SUCCESS=$(echo "$INNER_JSON" | jq -r '.success')
RESULT_COUNT=$(echo "$INNER_JSON" | jq -r '.results | length')

if [ "$SUCCESS" = "true" ]; then
  echo -e "${GREEN}✅ Search successful${NC}"
  echo -e "   Found $RESULT_COUNT results:"
  echo ""
  
  # Display results
  echo "$INNER_JSON" | jq -r '.results[] | "   \(.title[0:60])...\n      \u001b[2m\(.url)\u001b[0m\n      \u001b[2mScore: \(.score)\u001b[0m\n"'
  
  # Display answer if present
  ANSWER=$(echo "$INNER_JSON" | jq -r '.answer // empty')
  if [ -n "$ANSWER" ]; then
    echo -e "${DIM}💡 Answer: ${ANSWER:0:150}...${NC}"
  fi
else
  ERROR=$(echo "$INNER_JSON" | jq -r '.error // "Unknown error"')
  echo -e "${RED}❌ Search failed: $ERROR${NC}"
  exit 1
fi

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${GREEN}  All tests passed!${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""





