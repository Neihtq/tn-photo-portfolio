#!/usr/bin/env bash
# Send a push notification to the user via ntfy.sh.
# Usage: ./scripts/notify.sh "message" [title] [priority]
set -euo pipefail
TOPIC="${NTFY_TOPIC:-thien-photoport}"
MSG="${1:?usage: notify.sh <message> [title] [priority]}"
TITLE="${2:-Photo Portfolio}"
PRIORITY="${3:-default}"
curl -fsS \
  -H "Title: ${TITLE}" \
  -H "Priority: ${PRIORITY}" \
  -d "${MSG}" \
  "https://ntfy.sh/${TOPIC}" >/dev/null && echo "notified: ${MSG}"
