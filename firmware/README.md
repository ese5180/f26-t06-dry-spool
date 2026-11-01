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
- A stable `dryspool_sensors` boundary; deterministic simulated readings are
  enabled until the team finalizes the sensor and load-cell hardware.
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

1. Copy `local.conf.example` to `local.conf` and set the nRF Cloud/Memfault
   project key.
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
the new image has a distinct version in MCUboot and Memfault.

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

Only `src/dryspool_sensors.c` is intentionally simulated. Once the parts are
selected, replace its two functions with real Zephyr sensor/load-cell drivers
and dehumidifier control. The Wi-Fi, queueing, cloud, diagnostics, signing,
memory layout, and FOTA layers should remain unchanged.
