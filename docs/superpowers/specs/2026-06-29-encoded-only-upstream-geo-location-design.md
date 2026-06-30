# Encoded-Only Deployer And Upstream Geo Metadata Repair

## Context

The current deployment chain has two separate issues that combine into the user-visible bug:

1. `cfnew-deployer` was changed to prefer `plain` source, which conflicts with the requirement that deployment must stay `encoded`-only.
2. The preferred-node naming and geo labeling flow spans upstream tooling (`yx-tools`) and downstream consumption (`cfnew`). `cfnew` already contains logic for geo-prefix generation and ProxyIP region matching, but the upstream result and upload path do not reliably preserve enough location metadata for all desired labels, especially for ProxyIP-related naming.

This spec defines a coordinated fix across:

- `cfnew-deployer`
- `cfnew`
- upstream `yx-tools` (or a controllable fork/local working copy)

The design keeps `plain` available only as a development artifact inside `cfnew`, not as a deployer-facing runtime choice.

## Goals

- Keep one-click deployment and default deployment strictly on `encoded`.
- Remove `plain` as a user-facing option from `cfnew-deployer`.
- Preserve `cfnew`'s current development model where `明文源吗` remains the editable source of truth used to generate `少年你相信光吗`.
- Trace and repair the preferred-node metadata path from `yx-tools` output into `cfnew` ingestion so node names consistently include location + base name.
- Extend the same repair to ProxyIP-related location marking where the current chain loses region context or only uses partial labels.

## Non-Goals

- This work does not remove `明文源吗` from `cfnew`.
- This work does not redesign the whole preferred-IP API schema unless a minimal schema extension is required.
- This work does not replace existing `cfnew` geo-prefix fallback logic that resolves real IP and queries geolocation.

## Current Findings

### Deployer Files

- The UI, static embedded assets, and API defaults currently expose or prefer `plain`.
- The requirement is the opposite: encoded-only deployment, no `plain` in public deployer flows.

### `cfnew` Files

- `cfnew` already implements:
  - preferred-node geo-prefix generation based on resolved real IP
  - Worker region detection
  - ProxyIP region matching and labeling
- `cfnew`'s preferred-IP API currently persists stable base fields such as `ip`, `port`, `name`, and `addedAt`.
- This means downstream naming can work, but only if upstream provides enough stable information in `name` or in minimal metadata fields that survive storage.

### `yx-tools` Files

- `yx-tools` is the upstream preferred-tool source referenced by `cfnew`.
- It supports testing by region and uploading results to Worker API, but the repair target is not just "can upload"; it is "uploads enough location-aware semantics for `cfnew` to preserve or reconstruct the desired label".
- The exact upstream upload implementation must be traced before code changes, but the design assumes the current output path is the most likely place where location semantics are flattened or lost.

## Recommended Approach

Use a two-layer repair:

1. Enforce encoded-only behavior in `cfnew-deployer`.
2. Repair upstream preferred result semantics in `yx-tools`, with `cfnew` providing backward-compatible parsing and fallback enrichment.

This approach is preferred over a downstream-only fix because downstream-only guessing would be less reliable when upstream uploads have already discarded location meaning.

## Architecture

### Layer 1: `cfnew-deployer` Encoded-Only Guardrail

Public deployer behavior must always resolve to `encoded`.

Required changes:

- One-click deploy default stays `encoded`.
- Advanced UI removes `plain` from the source selector, or disables it so it cannot be chosen.
- API-side default completion in Worker runtime and local Node runtime both force `encoded`.
- Tests assert that public deployer defaults and allowed values are encoded-only.
- Any documentation in deployer that suggests `plain` as a normal deploy mode is updated to clarify that deploy runtime uses encoded source.

This prevents future regressions where UI, static embedded assets, and runtime defaults drift apart.

### Layer 2: Upstream Metadata Preservation In `yx-tools`

Preferred-node naming should not depend entirely on downstream re-derivation when upstream already knows useful context.

The upstream output contract should preserve enough information for:

- preferred node base name
- region/location identity
- ProxyIP location identity when relevant
- downstream-safe stable display naming

Preferred rule:

- When upstream knows a stable location label, it should encode it into the uploaded/display name in the canonical format expected by users.
- When upstream only knows partial regional data, it should preserve that data in the name or in minimal metadata fields rather than dropping it.

Candidate canonical output form:

- `🇸🇬新加坡-优选节点-11`
- `🇭🇰香港-ProxyIP-HK-01`

The final exact ProxyIP naming convention should reuse existing downstream style as much as possible to avoid introducing a second naming language.

### Layer 3: `cfnew` Compatibility And Fallback

`cfnew` should accept both:

- new upstream-enriched results
- old/simple results without location metadata

Compatibility behavior:

- If upstream already provides a canonical location-aware `name`, preserve it.
- If upstream provides structured-enough region/location fields, use them before falling back to real-IP geolocation.
- If upstream provides only `ip`/`domain` and a generic base name, keep using the current fallback chain:
  - resolve real IP if needed
  - query geolocation
  - generate `geoPrefix`
  - compose final node name

For ProxyIP-specific entries:

- if upstream provides explicit region or proxy location markers, prefer those over heuristic reconstruction
- if upstream does not provide them, keep existing Worker-region and ProxyIP-region fallback logic intact

This keeps old data usable while allowing more accurate future uploads.

## Data Flow

### Preferred Nodes

1. `yx-tools` generates preferred results from speed tests.
2. `yx-tools` derives a stable location label from region/test context and any available location metadata.
3. `yx-tools` uploads results to the Worker preferred-IP API, preserving name/location semantics.
4. `cfnew` reads preferred entries from KV/API configuration.
5. `cfnew` decides:
   - preserve upstream canonical name if already sufficient
   - otherwise enrich via structured metadata
   - otherwise fall back to real-IP geolocation
6. Subscription generators emit final names like `🇸🇬新加坡-优选节点-11`.

### ProxyIP Labels

1. Upstream or config source provides ProxyIP candidates with region context when available.
2. `cfnew` prefers explicit region metadata.
3. If missing, `cfnew` uses existing Worker region detection and regional matching logic.
4. Final rendered name preserves region marker rather than collapsing to a generic `ProxyIP-*` label when stronger data is available.

## File-Level Change Plan

### Deployer Tests

- Revert prior `plain`-default changes in:
  - `public/app.js`
  - `public/index.html`
  - `functions/static-assets.js`
  - `functions/api/[[path]].js`
  - `server.mjs`
- Update or replace `tests/default-source-mode.test.mjs` so it enforces encoded-only behavior instead of plain-default behavior.
- If UI keeps a source selector for future internal use, it must not expose `plain` to normal deploy flows.

### `cfnew` Tests

- Trace preferred-IP ingestion and naming composition around:
  - preferred-IP API handling
  - preferred entry parsing/serialization
  - final node naming composition
  - ProxyIP labeling paths
- Add compatibility parsing for any minimal upstream metadata introduced by `yx-tools`.
- Keep `明文源吗` as source of truth and regenerate `少年你相信光吗` after fixes land.

### `yx-tools` Tests

- Trace where test results are transformed into upload payloads.
- Ensure upload payload preserves location semantics needed by `cfnew`.
- Prefer a minimal contract change:
  - retain `name`
  - optionally add minimal fields such as `regionCode`, `country`, `city`, or `sourceType` only if needed
- Keep output backward-compatible with current Worker API expectations where possible.

## Error Handling

- If upstream location resolution fails, upstream should still upload a valid preferred result with a fallback base name rather than blocking upload.
- If downstream receives incomplete metadata, `cfnew` must keep the current geolocation fallback path.
- If ProxyIP region metadata is missing, `cfnew` must still preserve existing region-matching behavior rather than silently degrading to broken naming.

## Testing Strategy

### `cfnew-deployer`

- Regression test: one-click deploy default is `encoded`.
- Regression test: runtime default completion is `encoded` in both Worker and Node server paths.
- Regression test: public UI does not expose usable `plain` deploy flow.

### `cfnew`

- Test: upstream canonical location-aware name is preserved.
- Test: old entries without metadata still gain location prefix through current fallback.
- Test: ProxyIP entries with explicit region metadata render expected labels.
- Test: ProxyIP entries without metadata still follow existing region fallback.

### `yx-tools`

- Test: generated upload payload includes expected naming/location semantics.
- Test: API upload path remains compatible with current Worker endpoint.
- Test: failure to resolve optional location metadata does not block upload.

## Risks

- Upstream `yx-tools` may encode location in a way that duplicates downstream enrichment unless precedence rules are explicit.
- ProxyIP naming may have multiple existing conventions; changing format too aggressively could create mixed labels.
- If upstream upload payload changes too much, it could break current API consumers. This is why the preferred approach is minimal contract extension plus downstream compatibility.

## Success Criteria

- `cfnew-deployer` no longer offers or defaults to `plain` in any public deployment path.
- New deployments use `encoded` only.
- Preferred nodes generated through the repaired chain consistently render as location + base name, e.g. `🇸🇬新加坡-优选节点-11`.
- ProxyIP-related labels preserve meaningful location markers instead of collapsing to generic names when region information exists.
- Old stored preferred entries still work through fallback behavior.

## Open Decision Resolved

The scope is:

- encoded-only restriction applies to `cfnew-deployer` public deploy flows
- `cfnew` keeps `明文源吗` for development and encoded generation
- upstream `yx-tools` is in scope for direct repair if root cause lives there
