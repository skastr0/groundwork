#!/bin/sh
set -eu

plugin_root="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [ -z "$plugin_root" ]; then
  script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
fi

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

emit_message() {
  message=$(printf '%s' "$1" | json_escape)
  printf '{"systemMessage":"%s"}\n' "$message"
}

if ! command -v node >/dev/null 2>&1; then
  emit_message "[groundwork] Groundwork Codex plugin requires Node.js 24 or newer. Install Node.js and rebuild or reinstall the plugin."
  exit 0
fi

node_major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || printf '0')
case "$node_major" in
  ''|*[!0-9]*) node_major=0 ;;
esac

if [ "$node_major" -lt 24 ]; then
  emit_message "[groundwork] Groundwork Codex plugin requires Node.js 24 or newer. Current Node.js major version is $node_major."
  exit 0
fi

hook_file="$plugin_root/dist/groundwork-codex-hook.mjs"
if [ ! -f "$hook_file" ]; then
  emit_message "[groundwork] Groundwork Codex plugin is missing dist/groundwork-codex-hook.mjs. Rebuild or reinstall the plugin package."
  exit 0
fi

loader_file="$plugin_root/hooks/groundwork-codex-hook-loader.mjs"
if [ ! -f "$loader_file" ]; then
  emit_message "[groundwork] Groundwork Codex plugin is missing hooks/groundwork-codex-hook-loader.mjs. Rebuild or reinstall the plugin package."
  exit 0
fi

exec node "$loader_file" "$hook_file"
