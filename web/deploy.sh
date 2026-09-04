#!/usr/bin/env bash
# Ships the built site.
#
# ⛔⛔ THE WEB SERVER MUST FALL BACK TO index.html. `try_files {path} /index.html` is what makes
# `/explore` load the app instead of 404ing, and it is not optional: without it every link works
# inside the app while every REFRESH and every shared link is a 404. `lib/router.ts` and this are a
# pair.
#
# ⛔⛔ RSYNC TO THE dist DIRECTORY, NEVER ITS PARENT. `--delete` against the parent takes the whole
# site with it, and on this stack it has 404'd a live site once already.
#
# ⛔⛔ NEVER PUT THE LOGO STORE INSIDE THE DEPLOY ROOT. A token's `logo` is written into its
# constructor with no setter, so a `--delete` that removed `/logos` would permanently break every
# token launched while it pointed there. The API keeps them outside on purpose.
set -euo pipefail
: "${HOST:?set HOST, e.g. root@1.2.3.4}"
: "${REMOTE_DIR:=/root/share-web/dist}"

npm run check
npm test
npm run build

# ⚠ Asserted, not assumed. A build that produced no index.html would otherwise sync an empty
# directory over a working site.
test -f dist/index.html || { echo "no dist/index.html — the build did not produce a site" >&2; exit 1; }

rsync -az --delete dist/ "$HOST:$REMOTE_DIR/"

echo
echo "⚠ Check the deployed page loads a route directly, not just the home page:"
echo "    curl -sI https://YOUR-DOMAIN/explore | head -1     # must be 200, not 404"
