#!/bin/sh
# Container entrypoint. Fly mounts a fresh volume owned by root over /data,
# which hides the image's own permissions, so fix ownership at start and
# then drop root for good before running the app.
set -e
# Files the app creates (database, write-ahead log, backups) are private to it.
umask 077
DATA="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  chown node:node "$DATA"
  [ -d "$DATA/backups" ] && chown node:node "$DATA/backups"
  exec su-exec node "$@"
fi
exec "$@"
