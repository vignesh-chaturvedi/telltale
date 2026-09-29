#!/bin/sh
# Nightly copy of the database, run by telltale-backup.timer. VACUUM INTO reads one consistent
# snapshot, so the collector keeps writing meanwhile. Keeps the latest copy and the one before.
set -eu
cd "${TELLTALE_DATA:-/var/lib/telltale}"
mkdir -p backup
rm -f backup/next.db
sqlite3 telltale.db "VACUUM INTO 'backup/next.db'"
if [ -f backup/latest.db ]; then mv backup/latest.db backup/previous.db; fi
mv backup/next.db backup/latest.db
echo "backed up $(du -h backup/latest.db | cut -f1)"
