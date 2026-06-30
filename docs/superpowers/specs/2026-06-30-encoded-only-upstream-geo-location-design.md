# Encoded-Only Deployment And Geo-Prefixed Preferred Nodes

## Context

The deployment chain spans three codebases with one user-visible requirement:

- `cfnew-deployer` must keep deploying the encoded `cfnew` worker.
- `yx-tools` should upload preferred nodes with region-aware display names when it has enough location information.
- `cfnew` should preserve those upstream names and only fill in the geo prefix when the upstream name is still plain.

The desired result is that a node previously uploaded as `优选节点-11` becomes `🇸🇬新加坡-优选节点-11` once location information is available, while already-prefixed upstream names are not rewritten by downstream fallback logic.

## Goals

- Keep public deploy flows in `cfnew-deployer` encoded-only.
- Ensure newly uploaded preferred nodes can render as `地区前缀 + 原节点名`.
- Keep old preferred-node records compatible without forcing a data migration.
- Preserve upstream names when they are already canonical and geo-prefixed.

## Non-Goals

- This work does not remove `明文源吗` from `cfnew`.
- This work does not make `cfnew` override upstream names that already contain a valid geo prefix.
- This work does not require a breaking change to the preferred-node API payload.

## Final Decisions

- Public deployment in `cfnew-deployer` stays `encoded` only.
- The preferred implementation is dual-layer:
  - `yx-tools` tries to generate the canonical display name before upload.
  - `cfnew` keeps a fallback path for records that still arrive without a geo prefix.
- If upstream naming and downstream IP geolocation do not match, upstream naming wins.
- `cfnew` only enriches names that do not already contain a canonical geo prefix.

## Recommended Approach

Use a split-responsibility repair:

1. Lock `cfnew-deployer` to encoded-only source selection and runtime defaults.
2. Teach `yx-tools` to upload preferred nodes with canonical geo-prefixed names whenever country or region context is available.
3. Teach `cfnew` to detect canonical upstream names and preserve them, falling back to real-IP geolocation only when the incoming name is still unprefixed.

This approach matches the confirmed behavior contract while still protecting old data and partial upstream uploads.

## Architecture

### Layer 1: `cfnew-deployer`

`cfnew-deployer` remains responsible only for deployment source selection.

Required behavior:

- Quick deploy defaults to `encoded`.
- Public UI does not expose a usable `plain` deploy option.
- Worker runtime and local Node runtime both default missing `sourceMode` to `encoded`.
- Documentation and tests align on encoded-only deployment.

### Layer 2: `yx-tools`

`yx-tools` is the preferred place to materialize the canonical display name because it already has the result row being uploaded.

Required behavior:

- When country or stable region information is known, upload `name` in canonical form:
  - `🇸🇬新加坡-优选节点-11`
- Preserve the original base node name after the geo prefix.
- If location information is missing, keep the original name and continue uploading.
- Minimal extra metadata such as `regionCode`, `country`, or `city` may be included if it helps downstream compatibility, but `name` remains the primary display field.

### Layer 3: `cfnew`

`cfnew` remains the compatibility and fallback layer.

Required behavior:

- If an upstream preferred node name is already canonical and geo-prefixed, preserve it as-is.
- If the upstream name is still plain, run the existing real-IP resolution and geolocation path to build the geo prefix.
- Do not override canonical upstream names even when downstream geolocation disagrees.
- Keep existing ProxyIP fallback naming behavior for records that do not carry explicit geo-prefixed names.

## Canonical Naming Rule

Preferred nodes use:

- `<flag><zh-location>-<base-name>`

Examples:

- `🇸🇬新加坡-优选节点-11`
- `🇭🇰香港-ProxyIP-HK-01`

The downstream preservation check should recognize this canonical shape and skip fallback renaming when it is already present.

## Data Flow

### Preferred Nodes

1. `yx-tools` produces result rows from speed tests.
2. `yx-tools` derives location context from available region or country metadata.
3. `yx-tools` uploads the preferred node with:
   - canonical `name` when location is known
   - plain `name` when location is unknown
4. `cfnew` reads preferred entries.
5. `cfnew` decides:
   - preserve canonical upstream name if present
   - otherwise derive a geo prefix from real-IP geolocation
6. Final subscriptions render names such as `🇸🇬新加坡-优选节点-11`.

### Conflict Rule

When an upstream canonical name conflicts with downstream geolocation:

- preserve the upstream canonical name
- do not rewrite it from downstream geolocation
- keep downstream geolocation only as a fallback for names that arrive without a canonical prefix

## Error Handling

- If `yx-tools` cannot derive location, it still uploads the node with the original base name.
- If `cfnew` cannot resolve or geolocate a plain upstream name, it keeps the original naming fallback behavior.
- If optional metadata fields are missing, the pipeline must still work based on `name`, `ip`, and current fallback logic.

## Testing Strategy

### `cfnew-deployer`

- Test that quick deploy defaults to `encoded`.
- Test that Worker and local server runtime defaults stay `encoded`.
- Test that public UI does not expose `plain`.

### `yx-tools`

- Test that upload payload generation prefixes names when region metadata exists.
- Test that names remain unchanged when region metadata is absent.
- Test that the upload payload stays compatible with the current Worker endpoint.

### `cfnew`

- Test that canonical upstream names remain unchanged.
- Test that plain upstream names still receive geo-prefix enrichment through the fallback path.
- Test that ProxyIP fallback naming still works when no canonical geo-prefixed name is present.
- Test that canonical upstream names are not rewritten even if downstream geolocation would differ.

## Risks

- Upstream region metadata may be incomplete or inconsistent; the design avoids blocking uploads in those cases.
- If canonical-name detection is too loose, `cfnew` could accidentally preserve malformed names; the detection should stay narrow.
- If canonical-name detection is too strict, some already-correct upstream names could be reprocessed; tests should cover representative node names.

## Success Criteria

- `cfnew-deployer` deploys encoded source only in public flows.
- New preferred nodes uploaded through `yx-tools` can appear as `🇸🇬新加坡-优选节点-11`.
- Old preferred nodes without prefixes still gain geo prefixes through `cfnew` fallback.
- Canonical upstream names are preserved verbatim by `cfnew`.
- Conflict cases follow the approved rule: upstream canonical naming wins, downstream only fills missing prefixes.
