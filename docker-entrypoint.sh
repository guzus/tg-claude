#!/bin/sh
set -e

# Fix ownership of persistent directories if running as root
if [ "$(id -u)" = "0" ]; then
    # Fix permissions on mounted volumes
    chown -R appuser:appgroup /persistent 2>/dev/null || true
    chown -R appuser:appgroup /app/data /app/logs /app/config /app/bots 2>/dev/null || true

    # Drop to appuser and run the app
    exec su-exec appuser "$@"
else
    # Already running as non-root, just exec
    exec "$@"
fi
