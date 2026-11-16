# DrySpool firmware

This is the common Zephyr application for the remainder of the venture project.
It targets `nrf7002dk/nrf5340/cpuapp/ns` with nRF Connect SDK 3.4.0 and is based
on Nordic's current online [`samples/wifi/nrf_cloud`](https://github.com/nrfconnect/sdk-nrf/tree/main/samples/wifi/nrf_cloud)
sample (audited at upstream commit `b338f2f8548027612c6a94f9379f39d41cf55c37`).

For a fresh teammate machine, additional devices, release publishing, and the
classroom demonstration sequence, follow
[`../docs/TEAM_SETUP_AND_DEMO.md`](../docs/TEAM_SETUP_AND_DEMO.md).

## What is implemented

- Wi-Fi connection management and nRF Cloud CoAP device messages.
- A queued, retrying telemetry path for temperature, humidity, remaining
  filament mass, and dehumidifier state.
- A stable `dryspool_sensors` boundary using Zephyr's BME280 driver for
  temperature and humidity; filament and dehumidifier state remain simulated.
- Memfault diagnostics and HTTPS transport within nRF Cloud.
- Memfault Release Management checks and HTTPS firmware download.
- MCUboot with a team-owned ECDSA-P256 signing key.
- An 896 KiB primary image slot in internal flash and an 896 KiB download slot in
  the nRF7002 DK's external MX25R64 flash.
- An 8 KiB internal-flash Memfault coredump partition, sized for the measured
  7,444 B complete dump without consuming application RAM.
- Test/confirm boot behavior so an image that fails product initialization can
  be reverted by MCUboot.

The online sample uses a newer Memfault module to carry Memfault traffic over
nRF Cloud CoAP. NCS 3.4.0 bundles Memfault 1.40, whose CoAP port is not
compatible with the nRF7002 target. This backport therefore keeps nRF Cloud
CoAP for product data but uses Memfault's officially supported direct HTTPS
transport for diagnostics, release checks, and image downloads.

## Local secrets

Two ignored files are required:

1. Create `local.conf` with the nRF Cloud/Memfault project key:

   ```text
   CONFIG_MEMFAULT_NCS_PROJECT_KEY="<PROJECT_KEY>"
   ```
2. Obtain the team's `keys/dryspool-signing.pem` through the private team
   channel. If creating the key for the first time, follow `keys/README.md`.

Do not commit either secret. Every teammate must use the same signing key;
otherwise their signed update will not match the public key built into MCUboot.

## Build

Open an nRF Connect SDK 3.4.0 terminal from Toolchain Manager, change to this
directory, and run:

```powershell
west build --pristine --sysbuild -b nrf7002dk/nrf5340/cpuapp/ns . `
  -d ../build-dryspool -- `
  '-DEXTRA_CONF_FILE=coap.conf;coap-fota.conf;local.conf'
```

Flash the initial MCUboot + application image over the debug probe:

```powershell
west flash -d ../build-dryspool
```

The release artifact uploaded to Memfault is:

```text
../build-dryspool/firmware/zephyr/zephyr.signed.bin
```

Increment both `VERSION` and `CONFIG_APP_VERSION` before making a release so
the new image has a distinct version in MCUboot and Memfault. Upload the exact
`zephyr.elf` from the same build as the signed binary; the build retains
Memfault's Build-ID descriptor even with LTO enabled so cloud data can be
matched to that ELF.

## Local hardware verification

The connected nRF7002 DK was tested on 2026-10-31 with NCS 3.4.0:

- The signed `0.1.0` image flashed, MCUboot validated and chain-loaded it, and
  the DrySpool application reached its UART shell.
- `wlan0` and the external `mx25r6435f` flash device both reported `READY`.
- Memfault reported `8192 B` coredump capacity for a `7444 B` required dump.
- A controlled Memfault fault rebooted the board, the complete `7444 B`
  coredump remained available after reboot, and the test dump was then cleared.

Cloud connectivity and the end-to-end FOTA path were subsequently verified on
2026-11-01; see **Verified FOTA results** below.

## First-device setup

1. Provision the device credentials and onboard its hardware-derived device ID
   by following the nRF Cloud NCS onboarding guide. NCS 3.4.0 does not contain
   the newer on-device credential-key-generation options used by the current
   upstream sample, so use the supported host provisioning flow and then keep
   credentials in TF-M Protected Storage.
2. In the UART shell, save the Wi-Fi network and connect:

   ```text
   wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD
   wifi cred auto_connect
   ```

3. Confirm the device appears in nRF Cloud and receives the four
   `DRYSPOOL_*` message streams.
4. Confirm diagnostic chunks arrive in the Memfault area of nRF Cloud.

The current nRF7002 DK configuration intentionally sets
`CONFIG_SAMPLE_MEMFAULT_BUTTONS=n` because the application already uses about
96% of its available RAM and cannot afford the sample's additional button
thread. Trigger a release check from the COM9 UART shell instead:

```text
mflt get_latest_release
```

`BUTTON2` is therefore not a FOTA trigger in this build.

## FOTA checkoff flow

1. Flash and run version 0.1.0; capture its serial log and cloud telemetry.
2. Change the version, rebuild with the same team key, and upload
   `zephyr.signed.bin` plus `zephyr.elf` symbols to the matching Memfault
   project (`software type: dryspool-app`, `hardware: nrf7002dk-rev1`).
3. Create and activate a Release for the device's cohort. Enable server-side
   Developer Mode while repeatedly testing to avoid development rate limits.
4. Run `mflt get_latest_release` on COM9. The running application checks for the
   Release, downloads it over Wi-Fi/HTTPS to external slot 1, marks it pending,
   and reboots.
5. MCUboot validates the hash and ECDSA signature, swaps it into internal slot
   0, and starts it in test mode. DrySpool confirms it only after the product
   sensor layer passes startup.
6. Verify that a foreign-key image fails signature verification. Demonstrate
   test-image confirmation by resetting the board again and confirming that the
   new version remains in slot 0 rather than rolling back.

## Verified FOTA results

The complete two-version flow was tested on the connected nRF7002 DK on
2026-11-01:

- Version `0.1.0+0` was running when release `0.1.1+0` was activated for the
  Memfault `default` cohort.
- The uploaded ECDSA-P256-signed payload was 858,974 B with SHA-256
  `8c7175e50204011958affc8e560a65c2901dc17d57b91adbe9c84cf6b06d6eb1`.
- `mflt get_latest_release` downloaded the payload over Wi-Fi/HTTPS to external
  slot 1 and rebooted the board. The next boot logged `Confirming FOTA update
  image`, proving that MCUboot had started it as an unconfirmed test image.
- `mflt get_device_info` then reported software type `dryspool-app`, version
  `0.1.1+0`, and hardware `nrf7002dk-rev1`.
- A forced heartbeat posted 217 B successfully, after which the Memfault device
  record reported `0.1.1+0`.
- A second application-core reset left the primary MCUboot header at version
  `0.1.1+0`, proving that confirmation persisted and no rollback occurred.
- A latest-release query for the updated version returned HTTP 204, confirming
  the expected no-update path.
- `imgtool verify` validated the release with the team key. A separately
  generated image signed by another ECDSA-P256 key failed verification with
  `No signature found for the given key`.

## Hardware work still to integrate

Filament and dehumidifier state in `src/dryspool_sensors.c` remain simulated.
Load-cell integration and physical dehumidifier control remain future work.

## BME280 communication and boot check

Verified on 2026-11-16 with the complete NCS 3.4.0
`nrf7002dk/nrf5340/cpuapp/ns` sysbuild, firmware version `0.1.7`.

| Signal | DK pin | Logic 2 connection on sensor side |
| --- | --- | --- |
| SDA | P1.02 / D14 (`arduino_i2c`) | CH0 |
| SCL | P1.03 / D15 (`arduino_i2c`) | CH1 |
| GND | Common ground | GND |

The operator corrected the wiring: BME VCC/GND come from the DK, with no
separate supply and no level shifter. Logic 2 measured both direct I2C lines
idling at approximately 1.77 V. The exact DK VCC header pin was not identified;
the operator confirms the sensor is downstream of the measured DK supply.
The detected sensor is BME280:
address **0x77**, chip-ID register **0xD0 = 0x60**. The initial expectation
of 0x76 was corrected after the hardware probe and operator confirmation.

From an NCS 3.4.0 terminal in `firmware/`, with the ignored local configuration
and team signing key installed:

```powershell
west build --sysbuild -b nrf7002dk/nrf5340/cpuapp/ns . -d ../build-closed-loop -- `
  '-DEXTRA_CONF_FILE=coap.conf;coap-fota.conf;local.conf'
west flash --no-rebuild -d ../build-closed-loop --dev-id 1050794921
```

UART COM7 at 115200 baud reported these real startup samples:

| Commanded startup | Temperature | Humidity | Reset-free observation |
| --- | ---: | ---: | --- |
| Software reset 1 | 24.28 C | 30.77 %RH | 30 s, passed |
| Software reset 2 | 24.28 C | 30.98 %RH | 30 s, passed |
| Pin reset 3 | 24.31 C | 31.10 %RH | 30 s, passed |

All three runs showed exactly one bootloader and application startup, the
same firmware build ID, sensor ID 0x60 at 0x77, and a responsive version shell.
The early-init fix disables TF-M's dedicated UART1/stdout logging reservation:
UART1 and TWIM1 share serial block 1. Application UART0, the partition layout,
and stack allocations are retained. Application RAM use is 394156/409600 B.

Logic 2 captured 8 seconds at 2 MHz on a real Logic 8. All 36 address frames
to 0x77 were acknowledged. The capture includes an acknowledged write of
register 0xD0 and repeated-start read returning 0x60. The final read-byte
master NACK and the unused 0x76 discovery-probe NACK are expected.
See [the capture](../GeneratedFiles/closed-loop/bme-boot.sal),
[decoded transactions](../GeneratedFiles/closed-loop/bme-i2c.csv), and
[boot results](../GeneratedFiles/closed-loop/bme-boot-results.json).

**Separate Wi-Fi issue:** `RDSR2 failed` / RPU initialization failure was
previously observed on unmodified `b4c61b0` and the normal-mode BME image. This check does not verify live
cloud reporting or FOTA transport. Their application paths remain unchanged.

**PPK2 baseline (2026-11-16):** Source Meter at the existing 3.6 V setting,
VOUT to P21 +, GND to P21 -, P22/P23 jumpers installed. DK USB was absent
in live Windows enumeration. This measures the whole DK input, including
the DK-powered BME, regulators and other board loads. A 29.99296 s power-on
window averaged **48.467715 mA**, totaling **5.233285 J**. One completed BME
read was captured: **23.43 C / 30.542969 %RH**, ID 0x60 at 0x77, 22/22 address
frames acknowledged. Thus window energy per delivered sample was 5.233285 J;
this is not isolated sensor conversion energy. All 2,999,296 PPK packets have
continuous counters. Output was switched off afterward.

[Raw PPK packets](../GeneratedFiles/bme-power/baseline/ppk-raw.bin),
[calibration metadata](../GeneratedFiles/bme-power/baseline/metadata.txt),
[power results](../GeneratedFiles/bme-power/baseline/power.json), and
[I2C capture](../GeneratedFiles/bme-power/baseline/i2c.sal) are retained.
PPK metadata reports `Calibrated: 0`; factory coefficients were used unchanged,
and no independent meter calibration or physical supply accuracy check was made.

The single power-related change is `CONFIG_BME280_MODE_FORCED=y`: request a
conversion at `sensor_sample_fetch()` and sleep afterward. Supply, application
interval, oversampling and logging stay unchanged. The complete sysbuild flashed
successfully; three 30-second UART boot checks passed (23.54/23.55/23.56 C;
29.03/29.10/29.06 %RH), with responsive shells and no unexpected resets.
Logic 2 verified ID 0x60 at 0x77, 23 acknowledged address frames, and
`ctrl_meas` register 0xF4 writes of 0x55 (forced mode), replacing baseline
0x57 (normal mode). [Optimized boot evidence](../GeneratedFiles/bme-power/forced-usb-boots/bme-boot-results.json).
Application RAM remains 394156 B; flash is 734264 B.

Matching USB-disconnected power-on measurement:

| Measurement | Duration | Average current | Window energy / delivered sample |
| --- | ---: | ---: | ---: |
| Normal-mode baseline | 29.99296 s | 48.467715 mA | 5.233285 J / 1 sample |
| Forced mode | 29.98784 s | 50.147076 mA | 5.413689 J / 1 sample |

**Average current increased 3.4649%**; calculated reduction is **-3.4649%**.
Window energy increased 3.4472%. This pair does **not** demonstrate a power
saving or isolate the BME contribution. Each nominal 30-second window
includes whole-DK startup and background activity, and there is only one
capture per firmware. The external setup and sampling settings match;
internal activity and repeatability were not established.

The forced-mode P21 capture contains a real 23.64 C / 29.286133 %RH read,
ID 0x60 at 0x77, 23/23 address frames ACK, and forced-mode register writes.
All 2,998,784 PPK packets have continuous counters. Metadata and calibration
coefficients are byte-identical before/after. PPK output was switched off.

[After raw packets](../GeneratedFiles/bme-power/after/ppk-raw.bin),
[after I2C capture](../GeneratedFiles/bme-power/after/i2c.sal),
[after sensor decoding](../GeneratedFiles/bme-power/after/bme.json),
[comparison](../GeneratedFiles/bme-power/comparison.json), and
[scope/test notes](../GeneratedFiles/bme-power/after/notes.txt) preserve the evidence.
Raw binaries are original four-byte PPK packets, not native `.ppk2` files.
The current network wait allows only the startup delivered sample in the
measured window; normal mode continues autonomous conversions between reads.
An idle bus alone cannot prove continued application responsiveness.

To replay raw current conversion offline (Windows Python, `ppk2-api==0.9.2`):

```powershell
python GeneratedFiles/bme-power/replay_power.py GeneratedFiles/bme-power/baseline
python GeneratedFiles/bme-power/replay_power.py GeneratedFiles/bme-power/after
python GeneratedFiles/bme-power/compare_power.py
```

Short demo procedure:

For a TA demonstration of the already-flashed image, keep BME SDA on P1.02,
SCL on P1.03, and VCC/GND on the DK. Turn PPK2 output off and connect the DK
debugger USB. In a VS Code terminal at the repository root, run:

```powershell
py -m pip install pyserial  # only needed once
py firmware/demo_bme_serial.py --port COM7
```

Press the DK RESET button **after** the script says it opened the port. It
prints the real UART lines and reports PASS after `BME probe: address 0x77,
chip ID 0x60` and a `BME280 startup: ... C, ... %RH` reading. If the DK UART
has another COM number, substitute that number for COM7. The script only
listens; it does not flash, reset, or measure power. Wi-Fi connection errors
may appear later and do not invalidate the local BME reading.

For the longer automated HIL verification:

1. Keep the direct sensor wiring and connect the DK USB for UART/debug.
2. Build and flash with the commands above if needed.
3. With Logic 2 automation enabled, run the Windows Python script
   `GeneratedFiles/closed-loop/verify_bme_boots.py` from the repository root
   (`pyserial` and `logic2-automation` required). It uses COM7 and probe
   1050794921, commands three startups, and checks 30-second windows.
4. Review the three UART logs, JSON results and Logic 2 capture; track Wi-Fi
   separately. The script does not control PPK2.

For paired PPK measurements, first verify/flash with DK USB attached and PPK
output off. Disconnect DK USB before running `capture_power.py baseline`
(or `after`) with Windows Python (`ppk2-api==0.9.2`, `logic2-automation`,
`pyserial`). Use a fresh output folder. The script requires the existing
3.6 V Source Meter configuration, guards against COM6/COM7 being present,
records a 30-second power-on window plus 32-second I2C capture, and leaves
output off. Run `decode_bme.py` on that folder to verify ID/readings/ACKs
and count delivered samples. A single pair cannot establish repeatability
or isolate the BME contribution from whole-board startup variability.

### Five-minute forced-mode repeat

A further USB-disconnected P21 capture on 2026-11-16 kept the existing
3.6 V supply, wiring, firmware and sample settings unchanged.

| Window | Duration | Average current | Energy |
| --- | ---: | ---: | ---: |
| Full forced-mode run | 299.99616 s | 18.086114 mA | 19.532754 J |
| Excluding first 30 s | 269.99616 s | 14.830317 mA | 14.414863 J |

Minute averages were 36.146, 13.404, 13.576, 13.629 and 13.675 mA (the final
minute is 59.99616 s). All 29,999,616 PPK packet counters were continuous;
raw chunk checksums passed, and PPK metadata matches the earlier captures.
Output was switched off afterward. Current remains whole-DK input, including
BME and regulators; these are not isolated sensor-current measurements.

**Stability qualification:** I2C shows two complete BME initialization
sequences, with sensor soft-reset writes at 2.249513 s and 5.703683 s.
Both ID reads return 0x60 at 0x77; all 46 address frames ACK. Two completed
sample bursts yield 23.74 C / 28.701172 %RH and 23.73 C / 28.723633 %RH,
near 2.66 s and 6.12 s; there are no later BME samples in the capture.
This is consistent with a restart or reinitialization; UART/reset cause was
not captured, so five-minute application stability is **not verified**.
Window energy divided by the two reads is 9.766377 J/read, including all
startup/background loads. These are not two scheduled periodic samples.

There is no matching five-minute normal-mode capture yet. Do not compare
this longer average to the earlier 30-second baseline to claim a saving.
Earlier three-boot UART evidence remains limited to its 30-second windows.

[Power results](../GeneratedFiles/bme-power/forced-300s/power.json),
[1-second current summary](../GeneratedFiles/bme-power/forced-300s/current-1s.csv),
[raw chunk manifest](../GeneratedFiles/bme-power/forced-300s/capture.json),
[I2C capture](../GeneratedFiles/bme-power/forced-300s/i2c.sal), and
[run assessment](../GeneratedFiles/bme-power/forced-300s/run-assessment.json)
are retained. Raw samples are split into 8 MB files with no decimation.
Reproduction (Windows Python, same dependencies as above; USB absent):

```powershell
python GeneratedFiles/bme-power/capture_long_power.py forced-repeat-300s 300
python GeneratedFiles/bme-power/analyze_long_power.py forced-repeat-300s
python GeneratedFiles/bme-power/decode_bme.py GeneratedFiles/bme-power/forced-repeat-300s
```

Normal-mode comparison image preparation completed after the forced repeat:

```powershell
powershell -ExecutionPolicy Bypass -File GeneratedFiles/bme-power/sdk.ps1 build-normal
powershell -ExecutionPolicy Bypass -File GeneratedFiles/bme-power/sdk.ps1 flash-normal
python GeneratedFiles/bme-power/verify_normal_boots.py
```

`normal-mode.conf` overrides mode only; `firmware/prj.conf` still defaults to
forced mode. The build cache and currently flashed image are **normal mode**.
The normal image passed three 30-second UART boots (23.66–23.67 C and
28.25–28.36 %RH, responsive shells). Logic 2 confirmed 0x77/ID0x60,
22 acknowledged address frames and `ctrl_meas=0x57`. Application RAM remains
394156 B; flash is 734232 B. See [normal boot evidence](../GeneratedFiles/bme-power/normal-usb-boots/bme-boot-results.json)
and [mode verification](../GeneratedFiles/bme-power/normal-usb-boots/mode-verification.json).
The matching normal-mode capture is now complete with USB disconnected,
and PPK output is off. These checks do not resolve the repeated
initialization seen in the USB-disconnected forced-mode run.

### Matched five-minute power results

Both captures used 3.6 V Source Meter into P21, P22/P23 jumpers installed,
USB disconnected, and the same sample settings, wiring and capture method.
The scope is whole DK input including the DK-powered BME. Each contains
29,999,616 raw samples over 299.99616 s, with zero counter gaps and verified
chunk checksums. PPK configuration/calibration metadata are byte-identical.

| Window | Normal mean | Forced mean | Forced current reduction |
| --- | ---: | ---: | ---: |
| Full 299.99616 s | 18.425551 mA | 18.086114 mA | 1.842206% |
| Same first 30 s excluded | 14.895921 mA | 14.830317 mA | 0.440413% |

Total energy was 19.899340 J normal and 19.532754 J forced. Both runs show
substantial early current activity; the [one-second current plot](../GeneratedFiles/bme-power/long-power-current.png)
preserves that temporal context. These observed differences do **not**
establish repeatability or a causal BME-only saving from one pair.
Normal mode has one BME initialization and one completed read (23.69 C /
28.3125 %RH, ID0x60 at0x77, 22/22 address frames ACK). Forced mode has two
initializations and two startup reads. This mismatch and lack of continuous
UART/reset-cause evidence leave five-minute application stability unverified.
There are no later BME sample reads in either I2C capture; periodic reporting
was not demonstrated. Whole-window energy per read is not a useful direct
cross-mode efficiency comparison because those startup-read counts differ.

Normal [raw manifest](../GeneratedFiles/bme-power/normal-300s/capture.json),
[power results](../GeneratedFiles/bme-power/normal-300s/power.json),
[I2C capture](../GeneratedFiles/bme-power/normal-300s/i2c.sal),
[run notes](../GeneratedFiles/bme-power/normal-300s/notes.txt), and
[reproducible comparison](../GeneratedFiles/bme-power/long-comparison.json)
are retained. The DK is left flashed in **normal mode**, PPK output off.
No Wi-Fi code was changed or diagnosed; nothing pushed.

For a fresh matching normal capture after flashing the normal variant above:

```powershell
python GeneratedFiles/bme-power/capture_long_power.py normal-repeat-300s 300
python GeneratedFiles/bme-power/analyze_long_power.py normal-repeat-300s
python GeneratedFiles/bme-power/decode_bme.py GeneratedFiles/bme-power/normal-repeat-300s
```

Replay the saved comparison with `compare_long_power.py`; generate the plot
with `plot_long_power.py` (matplotlib). Neither tool accesses hardware.
