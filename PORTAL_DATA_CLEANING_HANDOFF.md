# Data Cleaning Migration Hand-off for VN Market Data Portal

## 1. Mission

Move ownership of the existing SensorTower data-mapping and cleaning workflows into the VN Market Data Portal. Portal users must be able to create, view, edit, validate, version, export, and publish mapping data without opening the standalone cleaning application.

The destination implementation must use the portal's existing visual language, navigation, authentication, RBAC, API client, FastAPI backend, PostgreSQL database, audit system, and control-agent boundary. The current cleaning app is the behavioral reference and data migration source, not the UI template.

## 2. Repositories and source locations

### Current cleaning workbench (source/reference)

- Repository: `D:\Coding\data_cleaning_tool_rev_multiplier`
- Framework: Next.js 15, React 19, TypeScript
- Current persistence: JSON and CSV files under `storage\`
- Main routes:
  - `/`: registered-publisher overview and Top Down queue
  - `/publishers/[publisherKey]`: Top Down publisher game editor
  - `/bottom-up`: Bottom Up multi-step workflow
  - `/audit-trail`: activity history
  - `/settings`: production source settings

### VN Market Data Portal (destination/owner)

- Repository: `D:\Coding\vn_market_data_site`
- Frontend: Vite, React 19, React Router, TanStack Query/Table, portal CSS and Lucide icons
- Backend: FastAPI, SQLAlchemy, Alembic, PostgreSQL, Google OIDC, CSRF, RBAC, API keys, audit events
- Host operations: HMAC-authenticated control agent, preferably over its Unix socket
- Relevant destination files:
  - `src\App.tsx`: sidebar and route registration
  - `src\pages.tsx`: current page implementations and portal UI patterns
  - `src\lib\api.ts`: authenticated/CSRF-aware frontend API client
  - `backend\app\main.py`: portal API routes
  - `backend\app\models.py`: SQLAlchemy models
  - `backend\alembic\versions\`: PostgreSQL migrations
  - `control_agent\agent\main.py`: mapping-file validation, application, and Git commit boundary

### Production SensorTower system

- Local development/reference repository: `D:\Coding\vn_strategy_data_system`
- The portal control agent currently defaults to `/opt/sensortower_data_system` on the VM. Use the configured `SENSORTOWER_ROOT` in production and do not hardcode either local path.

## 3. Current migration inventory

Point-in-time inventory inspected on 2026-09-11:

| Item | Current count |
| --- | ---: |
| Registered publishers | 16 |
| Top Down game rows | 528 |
| Top Down saved versions | 3 |
| Top Down retained activity entries | 100 |
| Top Down artifacts | 26 |
| Bottom Up mapping rows | 216 |
| Bottom Up checked publisher names | 24,078 |
| Bottom Up publisher candidates | 24,152 |
| Bottom Up retained activity entries | 33 |
| Bottom Up artifacts | 1 |

Authoritative migration inputs:

- `storage\top-down-workbench.json`
- `storage\bottom-up-workbench.json`
- `storage\imports\`
- `storage\exports\`

Do not migrate credentials from `storage\app-settings.json`. Production source credentials belong in the portal's server-side deployment configuration.

## 4. Product placement and permissions

Add `Data cleaning` to the portal's Workspace navigation, not its Administration-only navigation. Recommended portal routes:

- `/cleaning`: workflow dashboard with status, unresolved counts, last production load, drafts, and recent activity
- `/cleaning/publisher-apps`: Top Down registered-publisher queue
- `/cleaning/publisher-apps/:publisherId`: dedicated publisher game editor
- `/cleaning/publisher-revenue`: Bottom Up Guide and Steps 0-3
- `/cleaning/versions`: version history and restore actions
- `/cleaning/activity`: filtered cleaning activity history

Apply this role matrix:

| Capability | Viewer | Analyst | Admin |
| --- | :---: | :---: | :---: |
| View mappings and published output | Yes | Yes | Yes |
| Export CSV | Yes | Yes | Yes |
| Edit drafts, import CSV, resolve SensorTower data | No | Yes | Yes |
| Save/restore explicit versions | No | Yes | Yes |
| Run bulk production refresh | No | Yes | Yes |
| Publish mapping files into the production repository | No | No | Yes |
| Configure schedules or publication controls | No | No | Yes |

Use the authenticated portal principal as the actor. Remove all editable `operatorName` and `Adder` controls. `added_by`, `updated_by`, and audit actors must be assigned server-side.

## 5. Workflows and required behavioral parity

### A. Registered publisher entity

Maintain a shared publisher registry that both Top Down and Bottom Up use.

- Fields: stable ID, display name, URL-safe key, revenue multiplier, active status, timestamps, creator/updater.
- Generate the key from the publisher name and enforce uniqueness. Never ask users to type it.
- Revenue multiplier is editable on the publisher registry only.
- Bottom Up Step 2 displays the current registry multiplier as a read-only joined value.
- Prevent deletion when mapping rows reference the publisher; support deactivation instead.

### B. Mapping Publisher to Apps (Top Down)

Publisher queue behavior:

- Add a registered publisher by name.
- Show row count, flattened app count, needs-review count, and SensorTower issue count.
- Open each publisher in a dedicated editor.
- Edit the publisher's revenue multiplier from the registry surface.

Publisher editor behavior:

- Editable game name, review status, SensorTower link, notes, selected iOS apps, and selected Android apps.
- Read-only SensorTower link validity, SensorTower game name, unified app ID, actor, and timestamps.
- Add a row at the current working location, insert below any row, and keep newly inserted rows visible even while filters are applied.
- Delete one row or batch-delete selected rows only after confirmation.
- Batch-update status and batch-fetch SensorTower for selected rows.
- Multiple simultaneous filters across every displayed field. Draft filter changes take effect only after `Apply Filters`, so an edited row does not disappear while being corrected.
- Sortable columns must cycle ascending, descending, then unsorted.
- Paginate above and below the table and keep selection semantics clear between current page and all matching rows.
- Undo/redo local editing history must coexist with autosave. Autosave must not clear the undo stack.
- Debounced autosave, visible saving/saved/error state, explicit `Save now`, and optimistic concurrency conflict handling.

SensorTower resolution behavior:

- Parse a SensorTower overview link and determine its unified app ID.
- Numeric path candidates are iOS local IDs; package-like candidates are Android local IDs; a 24-character hex segment may be a direct unified ID.
- Resolve local app records to a single unified ID and reject conflicting IDs.
- Fetch unified-app children and enrich iOS/Android options with app ID, publisher name, app name, OS, and unified app ID.
- Always show all available options with checkboxes; selected options remain visible and checked.
- Allow multiple selections per platform.
- Keep manual multi-entry fallback available even after a successful fetch.
- Validate a manual app ID against SensorTower and indicate whether it belongs to the fetched unified app.
- Show per-row loading, success, empty, and failure states.
- Maintain a fixed SensorTower issue counter. Clicking it applies the invalid-link filter.

CSV behavior:

- Accept the existing Google Sheet and normalized column aliases documented in the source README and `lib\top-down\workbench.ts`.
- Ignore empty rows and embedded repeated header rows.
- Convert legacy singular iOS/Android IDs and store-account names into platform-entry records.
- Upsert uploaded rows by unified app ID extracted from SensorTower links. CSV data wins for a matching unified ID; unmatched rows are inserted.
- Rows without a resolvable unified ID are inserted without silently replacing another row.
- Flatten export to one row per selected platform app with exactly:
  - `os`
  - `cleaned_publisher_name`
  - `game_name`
  - `sensor_tower_link`
  - `app_id_trimmed`

### C. Mapping Publisher to Publisher ID and Revenue Multiplier (Bottom Up)

Keep the spreadsheet-inspired workflow split into separate portal-native screens or step tabs:

1. Guide: explain purpose, inputs, outputs, preservation rules, and publication behavior.
2. Step 0: load App Full Info from the production SensorTower API and identify VN-related apps.
3. Step 1: map raw `publisher_name` values to registered cleaned publishers.
4. Step 2: review/edit publisher-ID mappings and read-only revenue multipliers.
5. Step 3: validate and export/publish the final CSV.

Step 0 rules:

- Read production data through the portal backend and existing SensorTower upstream client. Do not expose a SensorTower or Strategy API key to the browser.
- A row is related to VN when `valid_countries` contains `VN`, `top_countries` contains `VN`, or `publisher_country` contains `Vietnam` case-insensitively.
- Display app ID, name, publisher name/ID, humanized name, the three VN signals, and final related-to-VN result.
- Use real asynchronous progress based on fetched pages/rows, not a simulated timer.
- Show start time, processed count, total when known, failures, completion summary, and `Last loaded on`.
- Reloading production data must upsert generated mappings while preserving manual cleaned publisher choices, notes, statuses, checked flags, and audit history wherever keys still match.

Step 1 rules:

- One candidate per unique raw publisher name, with publisher IDs, source app count, checked state, and a capped associated-app preview.
- Hover/focus over a raw publisher name to show associated apps; app names link to the correct store page.
- `cleaned_publisher_name` is a selection from the shared registered publisher registry, never free text.
- Support server-side pagination, sorting, multi-filtering, and boolean filters for registered-list membership, latest-mapping membership, and checked state.
- Support row check/uncheck and batch mark checked/unchecked.
- `Select filtered` applies to all server-side matches beyond the visible page without loading thousands of names into the browser.

Step 2 rules:

- Fields: cleaned publisher, publisher ID, raw publisher name, read-only revenue multiplier, review status, automatic actor/date, notes, and row actions.
- Add row, insert below, delete with confirmation, batch status, batch delete, filtering, sorting, pagination, autosave, and versioning.
- CSV import upserts by `publisher_id`; imported CSV wins for matches and unmatched IDs are inserted.
- Revenue multiplier is joined from the registered publisher entity at read/export time and cannot be directly edited in Step 2.

Step 3 output must contain exactly:

- `cleaned_publisher_name`
- `publisher_id`
- `publisher_name`
- `revenue_multiplier`

Block production publication when required values are missing, duplicate publisher IDs conflict, a cleaned publisher no longer exists, or the multiplier is invalid. Permit CSV download with a visible validation report, but clearly label invalid output as a draft.

## 6. Portal-native persistence design

Replace the JSON file stores with PostgreSQL and Alembic migrations. Use explicit workflow tables rather than one large JSON document.

Recommended entities:

- `cleaning_publishers`: shared registered publisher and revenue multiplier.
- `cleaning_top_down_rows`: game row, order, SensorTower link/resolution metadata, status, notes, actor/timestamps, and integer revision.
- `cleaning_top_down_apps`: one record per available/manual platform option, including OS, app ID, publisher/app names, source, unified ID, and selected state.
- `cleaning_bottom_up_rows`: publisher-ID mapping, raw publisher name, cleaned publisher FK, status, notes, actor/timestamps, and revision. Do not duplicate revenue multiplier.
- `cleaning_bottom_up_candidates`: current production-load candidate per raw publisher name, checked state, app count, publisher IDs, load run ID, and cleaned publisher FK.
- `cleaning_bottom_up_candidate_apps`: capped hover-detail rows with store URL.
- `cleaning_sync_runs`: source, status, counts, progress, error, started/finished times, and actor.
- `cleaning_versions`: workflow/dataset, immutable JSON snapshot, label, actor, timestamp, and row count.
- `cleaning_artifacts`: workflow, import/export kind, original name, media type, checksum, storage location/content, actor, and timestamp.

Use `NUMERIC`, not floating point, for revenue multiplier. Preserve app IDs and publisher IDs as strings because Android IDs and some publisher IDs are not numeric.

Store small CSV artifacts in a dedicated durable portal artifact volume with PostgreSQL metadata and SHA-256 checksum. Do not write artifacts inside either Git checkout. Keep the production mapping file itself under control-agent ownership.

Every mutable row must have an integer `revision`. Mutating APIs require the expected revision and return HTTP 409 with the latest row when stale. Autosave should patch changed rows only, not resubmit an entire 24,000-row dataset.

## 7. API design

Add portal endpoints under `/api/v1/cleaning`. All mutations use the existing CSRF dependency and role checks.

Core endpoints:

- `GET /overview`: workflow cards, counts, issues, last syncs, and recent versions.
- `GET/POST /publishers`: list/create registered publishers.
- `PATCH /publishers/{publisher_id}`: rename/deactivate/update multiplier with revision check.
- `GET /top-down/publishers/{publisher_id}/rows`: server-side pagination/filter/sort.
- `POST /top-down/publishers/{publisher_id}/rows` and `POST /rows/{row_id}/insert-after`.
- `PATCH/DELETE /top-down/rows/{row_id}` with expected revision.
- `POST /top-down/rows/batch`: status/delete/SensorTower-fetch for selected IDs or all matching a filter snapshot.
- `POST /top-down/publishers/{publisher_id}/import`: parse, preview merge counts/conflicts, then confirm application.
- `POST /top-down/rows/{row_id}/resolve` and `/lookup-app`.
- `GET /top-down/export`: validation plus streamed CSV.
- `POST /top-down/sensortower-refresh`: create an asynchronous validation run.
- `GET /bottom-up/step0/apps`: server-side page/filter/sort for the latest load.
- `POST /bottom-up/sync-runs` and `GET /bottom-up/sync-runs/{run_id}` for real progress.
- `GET/PATCH /bottom-up/step1/publishers` and `POST /bottom-up/step1/check`.
- `GET/POST/PATCH/DELETE /bottom-up/step2/rows` plus batch/import endpoints.
- `GET /bottom-up/export`.
- `GET/POST /versions` and `POST /versions/{version_id}/restore`.
- `GET /activity` with workflow, actor, action, target, and date filters.

Use a serializable filter-rule contract shared by list and batch endpoints: field, operator, value. Batch requests must include either explicit IDs or a filter snapshot plus an explicit `all_matching=true`; never infer an all-row operation from the current page.

Long operations return `202 Accepted` with a run/job ID. The frontend polls with TanStack Query until completion and displays actual counts and errors.

## 8. Audit, versions, autosave, and undo/redo

- Record meaningful server-side audit events through the existing `audit()` helper: create/update/delete, imports, exports, resolves, batch actions, syncs, version save/restore, and publication.
- Include before/after summaries for mapping mutations but avoid placing full catalogs or credentials in audit JSON.
- Autosave after approximately 1.5 seconds of inactivity and immediately on explicit Save.
- Keep undo/redo as a client command history. Undo and redo issue ordinary revision-checked patches, so autosave persists the resulting state rather than blocking history.
- Pause autosave until the initial query has succeeded. Never initialize an empty shell and save it over unloaded server state; this caused a real data-loss incident in the source app.
- Explicit version restore must first create an automatic pre-restore snapshot and then restore transactionally.

## 9. Production publication

The portal control agent already defines and validates these mapping IDs:

- `publisher-apps-top-down`
- `publisher-revenue-bottom-up`
- `app-revenue-special-cases`
- `game-info-adjustment`

Its existing flow is suitable: `GET /mappings`, `POST /mappings/preview`, and `POST /mappings/apply`. Apply writes the validated CSV into the SensorTower repository and creates a Git commit.

Keep draft editing in portal PostgreSQL. Publishing must be a separate admin-only action:

1. Generate the canonical CSV from a consistent database transaction.
2. Run portal validation and show row counts, missing columns, blocking errors, and change summary.
3. Call the existing control-agent preview endpoint.
4. Require explicit admin confirmation displaying the target filename and summary.
5. Call apply, capture the returned Git commit SHA, and audit it.
6. Mark the published version and checksum in PostgreSQL.

Do not publish on autosave or ordinary export. Do not copy the current app's local filesystem publication/settings model.

The current portal `MappingsPage` is only an unavailable placeholder. Replace it with either a production-file inventory linked to Data Cleaning or redirect it to `/cleaning`; do not build a second competing editor there.

## 10. Scheduled SensorTower validation

Preserve the full-link revalidation that currently runs on Sunday after four weeks have elapsed.

- Implement the schedule in the portal backend, with schedule state stored in PostgreSQL.
- Run an hourly eligibility check and acquire a PostgreSQL advisory lock so only one portal instance can launch it.
- Eligibility: Sunday in the configured business timezone and at least 28 days since the last completed scheduled run.
- Process rows in bounded batches with rate limiting and per-row errors; do not fail the entire run for one invalid link.
- Persist actual progress in `cleaning_sync_runs` and expose it in the Data Cleaning dashboard.
- Generate issue counts from the latest validation status and link directly to a preconfigured invalid-link filter.
- Provide the same operation as an analyst/admin manual action.

## 11. One-time data migration

Create an idempotent portal-side import command, for example `backend/scripts/import_cleaning_workbench.py`. It should accept the source repository path, default to dry-run, and require `--apply` for mutation.

Migration sequence:

1. Back up the portal PostgreSQL database and current cleaning `storage\` directory.
2. Parse the two JSON stores using the current normalization behavior.
3. Import registered publishers and multipliers, preserving legacy IDs/keys in dedicated unique legacy-ID columns.
4. Import Top Down rows and all selected/resolved/manual platform options.
5. Import Bottom Up mapping rows and the 24,078 checked publisher names.
6. Regenerate Step 1 production candidates from the production API; do not treat cached candidate previews as authoritative.
7. Import version snapshots, activity entries, and CSV artifacts with checksums.
8. Compare source and destination counts, flattened Top Down CSV hashes, and Bottom Up final CSV hashes.
9. Re-run the command to prove idempotency and zero duplicate inserts.
10. Freeze the standalone app to read-only for acceptance, then retire it after sign-off.

The importer must tolerate the source's legacy singular app-ID fields and normalize them into platform entries. It must also detect concatenated/corrupt trailing JSON rather than silently discarding records.

## 12. Performance and security requirements

- Never serialize the entire Step 1 catalog into the initial HTML or React state. This previously produced an approximately 22 MB response and navigation near 28 seconds.
- All large tables use server-side pagination, filtering, sorting, and selection-by-filter.
- Cap associated-app hover previews and offer a paginated detail view if more are needed.
- Stream CSV exports and paginated production reads.
- Keep initial route payloads to summary data only; target less than 250 KB before static assets.
- Use the portal's Google identity, CSRF protection, RBAC, request IDs, API rate limits, and audit system.
- Never expose upstream API keys or control-agent credentials to the browser.
- Validate CSV size, UTF-8 decoding, headers, row count, formula-injection risks, and content before storing or publishing.
- Escape downloaded CSV cells beginning with `=`, `+`, `-`, or `@`.

## 13. What to borrow and what not to copy

Borrow behavior and pure transformation logic from:

- `lib\top-down\workbench.ts`: normalization, legacy compatibility, CSV parsing, flattening.
- `lib\top-down\sensortower.ts`: overview-link parsing and resolution rules.
- `lib\top-down\server.ts`: unified-ID upsert semantics, issue checks, version/activity behaviors.
- `lib\bottom-up\workbench.ts`: Bottom Up CSV parsing/export and publisher-ID upsert.
- `lib\bottom-up\server.ts`: VN-related rules, candidate aggregation, filter/sort semantics, reference matching.
- `components\publisher-games-editor.tsx` and `components\bottom-up-editor.tsx`: interaction requirements and edge cases.

Rewrite these in the portal's Python domain/service layer and React component system. Add fixture-based parity tests before deleting the TypeScript reference implementations.

Do not copy:

- JSON file persistence or JSON corruption-recovery code.
- Editable local operator names.
- Browser/admin entry of production API secrets.
- Next.js route handlers, app shell, or CSS theme.
- Whole-dataset autosave payloads.
- Simulated progress timers.
- The source Prisma schema as-is; it is stale and still models singular app IDs.

## 14. Delivery sequence

1. Foundation: Alembic schema, domain services, permissions, audit hooks, artifact storage, and migration dry-run.
2. First meaningful portal slice: Data Cleaning dashboard, publisher registry, and one read-only publisher detail using migrated data and portal styling.
3. Top Down parity: editing, SensorTower resolution, multi-platform selection, filters/sort/batch, autosave/history, CSV import/export, versions.
4. Bottom Up parity: production sync with real progress, Step 1 server-side cleaning, Step 2 mappings, Step 3 validation/export.
5. Publication: control-agent preview/apply, admin confirmation, commit SHA/version tracking.
6. Migration and reconciliation: apply importer, compare counts/hashes, user acceptance testing.
7. Cutover: make the old app read-only, monitor one normal operating cycle, then archive it.

Do not start by visually cloning the standalone app. Establish portal-native data ownership and API contracts first, then reproduce the proven interactions inside the portal design system.

## 15. Required tests and acceptance criteria

Backend tests:

- CSV aliases, repeated headers, blank rows, Unicode, formula escaping, and malformed CSV.
- Top Down unified-ID upsert, duplicate handling, rows with no unified ID, and flattened multi-app export.
- SensorTower URL formats, conflicting local candidates, empty children, invalid links, and manual app validation.
- VN-related Step 0 rules and preservation of manual fields after repeated production sync.
- Step 1 pagination/filter/sort/check-all-matching at 25,000+ candidates.
- Bottom Up publisher-ID upsert and read-only multiplier join.
- optimistic concurrency, transactional restore, permissions, audit event creation, and publication validation.
- migration dry-run/apply/idempotency and source/destination count/hash reconciliation.

Frontend acceptance:

- Portal visual system is used consistently on desktop and mobile-width layouts.
- A user can complete Top Down and Bottom Up without visiting the old app or editing a file manually.
- Applied filters remain stable while rows are edited until the user reapplies them.
- Add/insert rows remain visible under an active filter.
- Tri-state sorting returns to original order.
- Batch operations clearly distinguish visible-page selection from all-filtered selection.
- Undo/redo works before and after autosave.
- Real progress and partial errors are visible for production sync and bulk SensorTower refresh.
- Viewer/analyst/admin permissions match the matrix above.
- Admin publication shows preview, requires confirmation, commits through the control agent, and records the SHA.

Performance acceptance:

- `/cleaning` and workflow entry routes do not embed full datasets.
- Normal portal navigation is responsive without 10-30 second route stalls.
- Step 1 handles at least 25,000 candidates without browser-side materialization.
- No mutation can overwrite a dataset with an unloaded empty client state.

Production verification:

- Run `npm run build` in the portal frontend.
- Run `python -m pytest backend/tests` and `python -m pytest control_agent/tests`.
- Run the migration reconciliation report against a backup/copy first.
- Preview both production mapping files through the control agent before enabling apply.
- Publish a non-production fixture in staging and verify the Git commit/audit/version linkage.

## 16. Definition of done

The migration is complete when portal users can perform all currently implemented Top Down and Bottom Up tasks with portal authentication and UI, current data/history is reconciled, large tables remain server-driven, production publication is controlled and audited, and the standalone cleaning app can be safely switched to read-only without blocking the monthly cleaning workflow.
