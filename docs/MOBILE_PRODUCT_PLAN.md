# Mobile product path

The branch implements user accounts and device claims. The web Dashboard reads
only the signed-in user's boxes. The phone app handles first setup over BLE. The
older deployed prototype still has a shared project view until the new backend
is configured and deployed. See the [web guide](../mobile/README.md) and the
[phone guide](../setup-app/README.md).

## Account and first setup

Users sign in, select a nearby box in DrySpool Setup, confirm with the box's
button, and select their Wi-Fi. A short-lived claim travels from the app to the
box. The backend checks the corresponding proof in the device's authenticated
nRF Cloud shadow before recording ownership. The web UI uses the device overview,
details and settings pattern from the
[Tapo T315 guide](https://static.tp-link.com/upload/manual/2023/202303/20230316/1910013360_Tapo%20T315_UG_V1.pdf#page=11).
Sharing, transfer and account recovery for an already claimed box require a
separate workflow. Changing Wi-Fi does not release ownership.

## Data and device states

- Show online only when a recent sample is available; stop showing readings as
  current once the freshness window expires. Preserve last-report time.
- Keep sensor validity independent: missing scale is `Not installed or not
  calibrated`, not `0 g`; unknown fan output is not `Off`.
- Distinguish cloud request failure, box offline, stale report, and command
  awaiting acknowledgement. Disable controls whenever the current fan state
  cannot be verified.
- Keep material identity scoped to a particular box and current spool. A tag
  replacement must clear or replace prior identity with a new timestamp.

## NFC and spool information

Prusa's newer Prusament spools use the open, rewritable OpenPrintTag format.
Older spools may have only a QR code. [Prusa introduction](https://blog.prusa3d.com/the-openprinttag-is-here-a-brand-new-nfc-tag-standard-for-smart-filament-is-now-shipped-with-a-new-redesigned-prusament-spool_123878/)
and [Prusa App instructions](https://help.prusa3d.com/article/openprinttag-nfc-filaments-with-prusa-app_1252992)
describe reading and writing, including creating a tag for third-party filament.
OpenPrintTag defines material and color fields; implement the published format
instead of looking up private Prusa inventory from a tag UID.

The candidate [X-NUCLEO-NFC10A1](https://www.st.com/en/evaluation-tools/x-nucleo-nfc10a1.html)
supports ISO15693/NFC-V and reading/writing NFC Type 5 tags. This indicates
radio-level feasibility, not a working DK connection. The
[ST25R200 datasheet](https://www.st.com/resource/en/datasheet/st25r200.pdf)
specifies 2.7–5.5 V for the peripheral IO rail. Check actual DK GPIO voltage,
provide suitable level matching, allocate SPI/IRQ/reset pins, port the reader
software, then test with a real Prusa OpenPrintTag and a blank writable tag.
Do not connect a 1.8 V DK GPIO directly to a higher-voltage output.

The proposed cloud identity object is `reported.dryspool.spool` with
`spool_valid`, `material`, `color`, `brand`, and `source`. The UI only displays
it when `spool_valid` is true and the sample is fresh. The write flow must
preview the fields, require a user confirmation, check that the tag is writable,
write the supported OpenPrintTag fields, read back and verify them, and report
errors without silently replacing an existing spool identity. Tag UID alone
does not establish trustworthy material. See [firmware integration points](NFC_INTEGRATION.md).

## Storage guidance

The dashboard currently provides a material-specific **maximum relative
humidity** only after a validated material is reported. The reference is
[Prusa USS Drybox guidance](https://help.prusa3d.com/article/prusa-uss-drybox_1014382):

| Material | Recommended in-box RH |
| --- | --- |
| PLA | Below 30%; short periods up to 40% tolerated |
| ABS | Below 30%; preferably below 15% |
| ASA | Below 30%; preferably below 10% |
| PETG | Below 20% |
| TPU | Below 20%; preferably below 15% |
| PVA | Below 20% |
| PC | Below 20% |

For unlisted materials, show no numeric recommendation until a suitable source
is verified. The temperature sensor reports storage conditions, but this box
has no heater or temperature control. Do not turn filament **drying**
temperatures into storage targets. A drybox helps maintain dry filament; wet
filament may need a separate drying process. The fan alone cannot guarantee a
humidity threshold; recommend checking seals/desiccant when RH is high.

## Optional slicer export

[PrusaSlicer accepts `.ini` profiles and bundles](https://help.prusa3d.com/article/how-to-import-and-export-custom-profiles-in-prusaslicer_382766?product=sl1).
This is a possible first target, but material/color and humidity do not define
safe nozzle, bed, or flow settings. First choose the slicer, printer, filament
brand and a verified profile, then test export/import round trips. Keep the
feature out of the current UI until a real profile source and format are
validated. Never include physical-printer API keys in an exported bundle.
