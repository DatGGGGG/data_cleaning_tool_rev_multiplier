# VN Strategy Data Cleaning Workbench

Starter web application for replacing the Google Sheets + Apps Script workflow used to prepare:

- `Mapping Publisher to Apps (Top Down)`
- future publisher mapping and revenue-multiplier workflows

## Current scope

This first scaffold includes:

- a `Next.js` + `TypeScript` app shell
- a spreadsheet-style editor for publisher tabs
- persistent local datastore under `storage/top-down-workbench.json`
- flattened output preview for `All Store Account Data - flattened`
- CSV seed import for a selected publisher sheet
- flattened CSV export plus saved export artifacts under `storage/exports`
- saved version snapshots and operator activity logs
- a `Prisma` schema kept as the future contract for shared database migration
- automatic full SensorTower refresh checks on Sundays once every 4 weeks while the app server is running

## Expected CSV import columns

The current importer accepts either the Google Sheet-style or normalized names:

- `Tên Game` or `game_name`
- `Link SensorTower` or `sensor_tower_link`
- `iOS App ID` or `ios_app_id`
- `Android App ID` or `android_app_id`
- `iOS Store Account` or `ios_store_account`
- `Android Store Account` or `android_store_account`
- `Adding Date`
- `Adder`
- `Notes`

## Run locally

From PowerShell:

```powershell
cd D:\Coding\data_cleaning_tool_rev_multiplier
.\node_modules\.bin\next.cmd dev -p 3015
```

Then open:

```text
http://127.0.0.1:3015/
```

Prefer `127.0.0.1` over `localhost`. Chrome may keep stale localhost redirects/cache from older dev runs and silently jump back to `localhost:3000`.

If the dev server behaves strangely after hot-refresh/cache issues, stop it with `Ctrl+C`, clear the Next.js cache, and restart:

```powershell
Remove-Item -Recurse -Force .next
.\node_modules\.bin\next.cmd dev -p 3015
```

If dependencies are missing, install them first:

```powershell
C:\Users\VEE0634\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd install
```

## Local startup troubleshooting

If port `3015` is already in use:

```powershell
netstat -ano | findstr :3015
```

Find the real PID at the end of the `LISTENING` line, then stop it:

```powershell
Stop-Process -Id <PID> -Force
```

Example:

```powershell
Stop-Process -Id 32048 -Force
```

Then start the app again:

```powershell
.\node_modules\.bin\next.cmd dev -p 3015
```

If the terminal shows `Ready` but the browser keeps spinning or jumps to `localhost:3000`, open this exact URL in a new tab:

```text
http://127.0.0.1:3015/
```

If `localhost` keeps misbehaving, test the server from PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3015/ | Select-Object StatusCode
```

If this returns `200`, the app is running and Chrome cache/redirect behavior is the issue. Use `127.0.0.1:3015` or clear Chrome site data for `localhost`.

## SensorTower full refresh

- The app now supports a backend full refresh of every row that has a SensorTower link.
- A built-in scheduler checks once per hour and will run the refresh on Sunday when at least 4 weeks have passed since the last full refresh.
- The scheduler only runs while the app server is alive.
- Manual endpoint: `POST /api/top-down/sensortower/full-refresh`
- Optional protection: set `SENSORTOWER_REFRESH_TOKEN` and send it as `x-refresh-token`

## Next implementation steps

- replace the local JSON datastore with shared database persistence
- add Google SSO or another team auth provider
- move raw CSV uploads and flattened exports from filesystem storage to object storage
- build the next workflow for publisher ID + revenue multiplier mapping
- add background jobs for Sensor Tower enrichment and publisher website crawling
