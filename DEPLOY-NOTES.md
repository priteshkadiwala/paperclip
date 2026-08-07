# Deploying this fork into Paperclip Desktop

The Desktop app bundles the server + UI at:
`/Applications/Paperclip Desktop.app/Contents/Resources/app-server/server/`
(`dist/` = compiled server, `ui-dist/` = built web UI)

The fork's feature lives entirely in those two folders. The bundled
`node_modules` stays untouched (the shared-package changes are compile-time
types only).

## Build (already done for v2026.707.0 / branch `approvals-inbox`)

```bash
cd ~/Developer/paperclip
pnpm --filter @paperclipai/shared build
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/ui build
```

## Deploy

1. Quit Paperclip Desktop (Cmd+Q).
2. Swap the two folders (originals are moved aside, never deleted):

```bash
APP="/Applications/Paperclip Desktop.app/Contents/Resources/app-server/server" && OLD="$HOME/Developer/paperclip-desktop-backup/replaced-$(date +%Y%m%d-%H%M%S)" && mkdir -p "$OLD" && mv "$APP/dist" "$OLD/dist" && mv "$APP/ui-dist" "$OLD/ui-dist" && cp -R "$HOME/Developer/paperclip/server/dist" "$APP/dist" && cp -R "$HOME/Developer/paperclip/ui/dist" "$APP/ui-dist" && echo "Swap complete."
```

3. Relaunch Paperclip Desktop.

## Rollback

Pristine v2026.707.0 copies live at
`~/Developer/paperclip-desktop-backup/v2026.707.0/` (`dist/`, `ui-dist/`).
Quit the app, put those back in place of the swapped folders, relaunch.

## Deploying a fork build newer than the Desktop shell (DONE 2026-08-07)

The Desktop app ships on its own version track (app v3.2.11, latest
release) and bundles whatever server version it was built with — v3.2.11
bundles server 2026.707.0. "Check for updates" will NOT bring a newer
server. So when the fork moves to a newer server version, assemble the
payload yourself: take the published npm package for the matching server
version (for its `node_modules`), then overlay the fork's own build.

```bash
# 1. Stage published deps for the target version
mkdir -p ~/Developer/paperclip-desktop-backup/stage-<VER> && cd $_
npm init -y && npm install @paperclipai/server@<VER> --omit=dev

# 2. Rebuild the fork (order matters)
cd ~/Developer/paperclip
pnpm --filter @paperclipai/shared build
pnpm --filter @paperclipai/plugin-sdk build   # or server typecheck sees phantom errors
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/ui build

# 3. Assemble payload: staged node_modules + staged package.json/skills
#    + fork's server/dist -> dist, fork's ui/dist -> ui-dist

# 4. SMOKE TEST the payload before touching the live app:
cd <payload> && PAPERCLIP_HOME=<scratch> PORT=3212 \
  PAPERCLIP_MIGRATION_PROMPT=never PAPERCLIP_MIGRATION_AUTO_APPLY=true \
  "/Applications/Paperclip Desktop.app/Contents/Resources/app-server/node-bin/node" dist/index.js
```

Then: snapshot live data (issues/agents/gates per company) → quit app →
kill the detached server on :3100 → cold-copy `db/`, `companies/`,
`secrets/`, `skills/` from the instance dir (skip `data/backups`, it is
5.7G of the app's own dumps) → move the old payload aside → copy the new
one in (dist, ui-dist, node_modules, package.json, skills) → relaunch →
diff live data against the snapshot.

Notes from the 707 -> 722 run:
- 48 migrations applied cleanly on first boot; no data touched.
- Upstream 722 seeds two built-in agents per company (Summarizer,
  Reflection Coach), created **paused**. Not data loss, not a bug.
- Old payloads are kept at `~/Developer/paperclip-desktop-backup/`
  (`replaced-707-*` has the full 707 payload incl. node_modules;
  `data-backup-*` has the cold DB copy).

## When the app auto-updates

The app updates itself from GitHub releases (`app-update.yml` →
aronprins/paperclip-desktop) and an update replaces the whole bundle,
wiping the feature. After an update:

1. Merge the matching upstream tag into the fork:
   `git fetch upstream --tags && git merge v<new-version>` on `approvals-inbox`
2. Re-run the build + deploy steps above.

Notes: modifying files inside the signed .app invalidates its code
signature; macOS normally keeps launching an already-installed app, but if
Gatekeeper ever complains, rollback and re-deploy cleanly.
