# Future NFC spool identification

Target reader candidate: X-NUCLEO-NFC10A1 / ST25R200. The MVP identifies
spools through the `dryspool spool <id> <empty_g>` serial command and saves
the active profile locally. The following are integration points for a
later feature.

## Firmware

- Add reader access alongside the existing [sensor modules](../firmware/src/sensors).
  Before enabling the reader, check its interface, voltage, and pin assignment
  against the [current board routing](../firmware/boards/dryspool-peripherals.dtsi).
- Keep tag detection separate from the active spool profile. Resolve a tag
  to a known spool and its empty mass before selecting it. Apply selection at
  the [profile](../firmware/src/spool/profile.h) boundary so manual selection
  and tag selection share the existing revision check. Preserve the on-flash
  `dryspool/v1` layout. A missing or unknown tag leaves manual selection available.
- Attach optional identity to the [sample snapshot](../firmware/src/readings.h)
  using the same profile revision as the weight. Send it through the
  [reported device shadow](../firmware/src/cloud/box_shadow.c) with the sample
  timestamp. Define how a newer sample clears stale identity when a tag is
  removed or replaced.

## Mobile dashboard

- Read optional identity in the [device model](../mobile/lib/cloud.mjs) and
  pass it through the existing [devices endpoint](../mobile/app/api/devices/route.js).
  Treat absent fields on older firmware and stale samples as unavailable.
- Surface the fresh identity on the matching [box card](../mobile/app/dashboard.js)
  and keep spool identity scoped to that box.

The default offline and connected profiles can run without a reader. Existing
weight, environment, fan, and OTA checks should continue to pass if the reader
is absent or fails.
