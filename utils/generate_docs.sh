#!/usr/bin/env bash
# generate_docs.sh — Compile .mmd Mermaid files into docs/images

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

DOCS_DIR="$PROJECT_ROOT/docs/images"
mkdir -p "$DOCS_DIR"

# Find all .mmd files in the project and render them
MMD_FILES=$(find "$PROJECT_ROOT" -name '*.mmd' -not -path '*/node_modules/*' 2>/dev/null || true)

if [ -z "$MMD_FILES" ]; then
    echo "ℹ️  No .mmd files found. Nothing to generate."
    exit 0
fi

echo "📊 Generating diagrams..."
for mmd in $MMD_FILES; do
    BASENAME=$(basename "$mmd" .mmd)
    OUTPUT="$DOCS_DIR/${BASENAME}.svg"
    echo "  → $mmd → $OUTPUT"
    npx -y @mermaid-js/mermaid-cli mmdc -i "$mmd" -o "$OUTPUT" -t dark
done

echo "✅ Done. Diagrams saved to $DOCS_DIR"
