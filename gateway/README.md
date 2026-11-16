# DrySpool BLE gateway and firmware updates

In the gateway setup, boxes A and B measure temperature, humidity and filament mass and drive their fans. They connect to gateway G over BLE. G uses one campus Wi-Fi MAC address, synchronizes its nRF Cloud device shadow over CoAP/DTLS and relays Memfault data and firmware over HTTPS. Use the [gateway-compatible mobile dashboard](https://github.com/ese5180/f26-t06-dry-spool/tree/5cff799265570e2f544c76aa58ac233a34c4e806/mobile) for this setup. The current three-box Wi-Fi setup uses the [direct-connect firmware](../mvp_firmware/README.md) and [three-box dashboard](../mobile/README.md).

## First flash

From the repository root, use an nRF Connect SDK 3.4.0 terminal. Follow the [team setup guide](../docs/TEAM_SETUP_AND_DEMO.md) to obtain the signing key and prepare `firmware/local.conf` with the Memfault Project Key. Use `nrfutil device list` to identify each board's probe serial number. The build script creates a separate directory for each role.

```sh
./gateway/build.sh A
./gateway/build.sh B
./gateway/build.sh G
west flash --no-rebuild -d build-gateway-pwa-A --dev-id SERIAL_A
west flash --no-rebuild -d build-gateway-pwa-B --dev-id SERIAL_B
./gateway/flash-g.sh "$PWD/build-gateway-pwa-G" SERIAL_G
```

Use USB when first migrating G to this configuration. The script writes the SDK's Wi-Fi patch to its reserved external flash area and programs the bootloader, application and network cores. Later application updates using the same layout and Wi-Fi patch can use cloud OTA.

## Network setup, pairing and dashboard

1. Open G's application UART at 115200 baud and register the MAC printed after `Register gateway Wi-Fi MAC`. Install G's CoAP device certificate and register its device ID using [step 4 of the onboarding guide](../docs/TEAM_SETUP_AND_DEMO.md#4-add-a-new-dk-to-nrf-cloud). Set `NRF_GATEWAY_ID` on the gateway-compatible PWA server to that ID. G needs network access to NTP, CoAP/DTLS and HTTPS.
2. For WPA2-PSK, run `wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD` in G's serial shell, then run `wifi cred auto_connect`. A and B use BLE and each reports its own hardware ID to Memfault.
3. To pair A, hold **Button 1** on G and A simultaneously until G receives readings. Repeat for B. Follow the [scale calibration steps](../mvp_firmware/README.md) to tare, calibrate and set the empty spool mass on each box. Remaining filament displays a dash until calibration is complete.
4. Open the deployed HTTPS address on the phone. G stores the latest readings in `reported.dryspool.A` and `reported.dryspool.B`. When a user changes fan mode, the server writes the mode, request ID and expiry to the target box's entry in `desired.config`. G copies the request to `reported.config` after the box confirms it. G ignores expired commands and waits for clock synchronization before applying commands.
5. Turn A's fan on and off. Check the physical fan, the confirmation on the phone and B's mode. Repeat for B and restore automatic control. G's serial output also shows a local dashboard URL and pairing code for networks that allow client-to-client access. The cloud PWA works from any internet connection.

## Publish a firmware update in nRF Cloud

Flash and provision all three boards first. G relays each box's Memfault heartbeat and periodically checks for releases using its serial number, hardware and software types, and running version. Each box has its own record for updates and diagnostics. G's shadow handles live controls for A and B.

| Board | Software type | Hardware version | Initial build directory |
| --- | --- | --- | --- |
| A | `dryspool-box-a` | `dryspool-box-a` | `build-gateway-pwa-A` |
| B | `dryspool-box-b` | `dryspool-box-b` | `build-gateway-pwa-B` |
| G | `dryspool-gateway` | `nrf7002dk-rev1` | `build-gateway-pwa-G` |

1. Record the running versions. In **Fleet → Devices**, verify the IDs, software types and versions of A, B and G. For a single-box demo, place only the target box in the demo cohort.
2. When ready to demonstrate an upgrade, increase `gateway/VERSION` above the running baseline and rebuild the target role into a separate directory with the same signing key. The signed A and B images carry a protected role identifier. G checks the role and MCUboot verifies the signature.
3. Under **Software → Symbol Files**, upload `gateway/zephyr/zephyr.elf` from that build. Under **Software → OTA Releases**, create a release for its software and hardware types and upload `gateway/zephyr/zephyr.signed.bin` from the same build. Verify the version and target cohort, then activate the release.
4. For A or B, G checks for the release, downloads the signed image and transfers it over BLE. The box reboots and runs its health checks. Compare the running version on the dashboard and in the cloud, then check the readings, the fan and the other box. G downloads its own updates over Wi-Fi. Run `mflt get_latest_release` in G's serial shell for an immediate check.
5. For a phone-to-box BLE demo, open **Image → Test & Confirm** in nRF Connect Device Manager and select the target box's `dfu_application.zip`. Hold **Button 1** on the box when first pairing the phone. [Nordic BLE FOTA tutorial](https://academy.nordicsemi.com/courses/nrf-connect-sdk-intermediate/lessons/lesson-9-bootloaders-and-dfu-fota/topic/exercise-5-fota-over-bluetooth-low-energy/) · [OTA for downstream devices](https://docs.nrfcloud.com/docs/best-practices/ota-components)

## Course demonstration

On G's UART, run `mflt get_device_info` to verify its identity. Run `mflt test heartbeat` and `mflt post_chunks` to check its metrics. Trigger a heartbeat on a box and wait for G to forward it, then check temperature, humidity, remaining filament and fan output in the individual A and B records.

To demonstrate a core dump on G, upload the running build's ELF and use `mflt coredump_size` to check storage capacity. Trigger a controlled reboot with `mflt test assert`, then use `mflt get_core`, `mflt post_chunks` and the corresponding cloud issue to verify the dump. Record the actual versions before and after the upgrade and observe the physical fan during the demonstration.
