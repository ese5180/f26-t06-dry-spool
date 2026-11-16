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

The operator-supplied power arrangement is regulated 3.3 V for the sensor
and a bidirectional I2C shifter referenced to 1.8 V on the DK side. Signal
voltages were not measured in this check. The detected sensor is BME280:
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

**Separate Wi-Fi issue:** `RDSR2 failed` / RPU initialization failure occurs
on both unmodified `b4c61b0` and this image. This check does not verify live
cloud reporting or FOTA transport. Their application paths remain unchanged.

**PPK2:** baseline average, optimized average, and percentage change are not
measured. Power measurements and pushing are paused by the operator; no
PPK2 settings or sensor power optimization were applied.

Short demo procedure:

1. Keep the supplied sensor/level-shifter wiring and connect the DK USB for UART/debug.
2. Build and flash with the commands above.
3. With Logic 2 automation enabled, run the Windows Python script
   `GeneratedFiles/closed-loop/verify_bme_boots.py` from the repository root
   (`pyserial` and `logic2-automation` required). It uses COM7 and probe
   1050794921, commands three startups, and checks 30-second windows.
4. Review the three UART logs, JSON results and Logic 2 capture; track Wi-Fi
   separately. The script does not control PPK2.
