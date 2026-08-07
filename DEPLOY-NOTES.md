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

## Deploying the v2026.722.0-based fork (current state)

The fork branch now contains upstream v2026.722.0. The old trick of
swapping dist into the v2026.707.0 Desktop shell does NOT work for this
code (server deps changed). Sequence:

1. Update Paperclip Desktop to stock v2026.722.0 (let auto-update run,
   or install the release build).
2. Rebuild the fork: shared, plugin-sdk, server, ui (in that order).
3. Quit the app, swap `dist` + `ui-dist` as below, relaunch.
4. First boot runs DB migrations (0136-0144) — deploy at a quiet moment
   and verify agents + a task page afterwards. Hourly DB backups exist
   under the instance data dir if rollback is ever needed.

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
