# DrySpool MVP firmware

The nRF7002 DK reads enclosure temperature and humidity from a BME280, estimates remaining filament from a load cell connected to a NAU7802, and controls the circulation fan. With Wi-Fi, it sends readings to nRF Cloud over CoAP/DTLS and downloads signed firmware updates over HTTPS through Memfault Release Management. Weighing, calibration, fan control, and the serial shell also work offline.

## Phone dashboard

A, B and C each run this same image and connect directly to Wi-Fi. The [mobile dashboard](../mobile/README.md) reads each board’s own cloud shadow for temperature, humidity, filament remaining, fan controls and firmware state. Start with one box and add the others as they are provisioned.

## Firmware layout

The local loop in [main.c](src/main.c) reads the sensors, updates the fan and publishes a sample. Each channel carries its own validity flag, so a scale error leaves humidity control available.

| To change | Files |
| --- | --- |
| Sensor access and raw readings | [BME280](src/bme280.c) and [NAU7802](src/nau7802.c) |
| Humidity thresholds and fan output | [Fan hysteresis](src/fan.h) and [GPIO driver](src/fan.c) |
| Tare, calibration and conversion to net grams | [Calibration](src/calibration.c) |
| Serial commands and saved spool settings | [Shell commands](src/commands.c) and [persistent profile](src/profile.c) |
| Cloud connection and measurement uploads | [Connection worker](src/cloud/cloud.c) and [telemetry sender](src/cloud/telemetry.c), which reads the [latest sample](src/readings.c) |
| Trial image confirmation after an update | [Local health check and confirmation](src/trial_image.c) |

## Wiring

Disconnect power before wiring. The DK uses **1.8 V GPIO** by default. Power the two sensor breakouts from a regulated 3.3 V supply and connect their ground to the DK ground. Use a bidirectional level shifter designed for open-drain I²C, with its low side referenced to 1.8 V and its high side to 3.3 V. Do not connect an I²C bus pulled up to 3.3 V directly to the DK’s default GPIO. [Nordic hardware guide](https://docs.nordicsemi.com/r/bundle/ug_nrf7002_dk/page/ug/nrf7002_dk/intro.html)

| DK pins | Connection |
| --- | --- |
| D14 / P1.02 (SDA), D15 / P1.03 (SCL) | Connect both the NAU7802 (0x2A) and the BME280 (configured for 0x76) on the sensor side of the level shifter. If your BME280 uses 0x77, change the BME280 node’s unit address to `@77` and its `reg` value to `<0x77>` in the [board overlay](boards/nrf7002dk_nrf5340_cpuapp.overlay), then rebuild. |
| A0 / P0.04 (digital output) | Connect to the fan driver’s active-high input. Use a driver that accepts 1.8 V logic or add level translation. Pull the input low so the fan stays off during reset. Power the 5 V fan from a separate supply through a suitable motor driver and share ground with the DK. GPIO supplies the control signal only. |

Connect the four-wire 5 kg load cell to the NAU7802’s E+/E− excitation and A+/A− signal terminals. Follow the wire assignments supplied with your load cell. Leave the B channel on newer boards unused. Fix one end of the beam and mount the entire spool holder on the other end. Keep the enclosure walls and cables clear of the holder so they cannot take part of the load. The total load, including the holder, must stay within 5 kg. [Load cell #4541](https://www.adafruit.com/product/4541) · [NAU7802 breakout #4538](https://www.adafruit.com/product/4538) · [Terminal diagram](https://learn.adafruit.com/adafruit-nau7802-24-bit-adc-stemma-qt-qwiic/pinouts)

## Build, flash, and open the serial shell

Run the following commands from the DrySpool repository root in an nRF Connect SDK v3.4.0 toolchain terminal. The cloud build uses the team’s Memfault Project Key from `firmware/local.conf` and its MCUboot signing key from `firmware/keys/dryspool-signing.pem`. On a new workstation, obtain the files from the project maintainer and keep them at those Git-ignored paths. [Team configuration guide](../docs/TEAM_SETUP_AND_DEMO.md#1-shared-project-configuration)

```sh
west build -p always --sysbuild -b nrf7002dk/nrf5340/cpuapp/ns \
  -d build-wifi-box mvp_firmware -- \
  "-DEXTRA_CONF_FILE=$PWD/firmware/local.conf"
nrfutil device list
west flash --no-rebuild -d build-wifi-box --dev-id JLINK_SERIAL
```

Repeat the flash command for each board, substituting its J-Link serial number. The same compiled image serves all three. For a board previously running a gateway or BLE image, install the Wi-Fi box baseline by USB first. When moving from the standalone bench firmware, use this wired flash procedure to install MCUboot and the application, then check the calibration and spool ID.

For sensor bench testing, build the standalone firmware with:

```sh
west build --no-sysbuild -p always -b nrf7002dk/nrf5340/cpuapp -d build-mvp-local mvp_firmware
```

Open the application core’s USB virtual serial port at **115200 baud, 8N1**. The application prints each set of readings and waits two seconds before the next sampling cycle. Serial temperature and humidity use thousandths of a degree Celsius and thousandths of a percent RH, respectively. For example, `rh_mPct=40500` means 40.5% RH.

## Calibrate the scale and select a spool

1. Leave the installed holder in place. Remove the spool and any weights. Once the readings settle, enter `dryspool tare` to save the zero point. Repeat the calibration step whenever you tare again.
2. Place a known weight on the holder and wait for a stable reading. For a 500 g weight, enter `dryspool cal 500`. Use the actual reference mass in grams. For each scale reading the firmware discards the pending conversion and averages five new conversions.
3. Remove the weight. Enter a spool ID and its measured empty mass, for example `dryspool spool PLA01 210`, then load that spool. The `remaining_g` value subtracts the holder’s tare and the 210 g empty spool from the measured load. Enter the new ID and empty mass each time you switch spools. The board stores the current spool.
4. Use `dryspool limits 30 40 100` to set the fan-off humidity, fan-on humidity (% RH), and low-filament threshold (g). These are the defaults for initial bench testing. Between the humidity thresholds, the fan keeps its previous state. If a humidity sample fails, the firmware requests fan-off. The `fan_command` field reports the GPIO command; there is no fan speed feedback.
5. A successful command prints `Saved.` and writes its settings to flash. Until calibration and empty spool mass are set, the firmware reports raw counts and marks grams unavailable. If a sensor read fails, the serial output reports `unavailable` for the affected measurement.

## Bench checks

- Check the net weight with a different reference mass from the one used for calibration. Record the error with the spool stationary, rotating, and feeding filament to the printer. Use those observations to choose a margin for the low-filament alert.
- Exercise both humidity thresholds. Compare the serial fan command, driver input, and physical fan as humidity crosses each threshold, then restore the desired thresholds.
- Start the DK without Wi-Fi and verify that the current spool ID, calibration, and thresholds still apply. Power off and disconnect one sensor at a time, then boot and check that the other function still works. After fixing the BME280 wiring, reboot so Zephyr initializes the sensor again.

## Connect to Wi-Fi and nRF Cloud

At 115200 baud, reset each DK and record its `Device Wi-Fi MAC` for network registration and its `nRF Cloud device ID` for the matching dashboard slot. The J-Link serial selects the USB debugger. Each DK has its own TLS credentials. For a new certificate set `--id-str` to the device ID printed by this DK when running the installer. For a previously onboarded DK, check its existing connection first. For a new board, follow step 4 of the team guide to install the board’s credentials through the application UART using `tls_cred_shell` and register the device in the team’s nRF Cloud project. Keep certificates, private keys, Wi-Fi passwords, and release tokens in restricted local storage. [Device onboarding instructions](../docs/TEAM_SETUP_AND_DEMO.md#4-add-a-new-dk-to-nrf-cloud)

Save a WPA2-Personal network and connect from the application shell:

```text
wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD
wifi cred auto_connect
```

After clock sync and cloud connection the board exchanges its dashboard shadow approximately every 5 seconds. The sensor history telemetry runs every 60 seconds by default. Check the device’s messages in nRF Cloud. Each report includes the currently valid channels. Raw NAU7802 counts are available before scale calibration. During an outage the board keeps only the latest sample in RAM. Reconnection resumes with fresh readings without replaying an outage history.

| Message appId | Value |
| --- | --- |
| `DRYSPOOL_TEMPERATURE_C` | BME280 temperature in °C |
| `DRYSPOOL_HUMIDITY_PCT` | Enclosure relative humidity in % RH |
| `DRYSPOOL_LOAD_CELL_COUNTS` | Signed NAU7802 ADC counts, averaged over five conversions |
| `DRYSPOOL_FILAMENT_G` | Calibrated filament mass in grams after subtracting the empty spool |
| `DRYSPOOL_DEHUMIDIFIER_ON` | Fan GPIO command, 1 for on and 0 for off |

## Verify telemetry and offline operation

Run these tests from the repository root with a C compiler. They check telemetry units and validity, fan switching at both humidity thresholds, and scale calibration with either load-cell polarity.

```sh
cc -std=c11 -I mvp_firmware/src mvp_firmware/tests/telemetry_test.c -o /tmp/dryspool-telemetry-test
/tmp/dryspool-telemetry-test
cc -std=c11 -I mvp_firmware/src mvp_firmware/tests/fan_test.c -o /tmp/dryspool-fan-test
/tmp/dryspool-fan-test
cc -std=c11 -I mvp_firmware/src mvp_firmware/tests/calibration_test.c \
  mvp_firmware/src/calibration.c -o /tmp/dryspool-calibration-test
/tmp/dryspool-calibration-test
```

Use the same DK for the online and offline checks:

1. Calibrate the scale, set the empty spool mass, and connect the DK. Check the timestamps and values in the device’s nRF Cloud messages. Add a known weight and leave it in place through the next upload. Compare the change in grams with the serial output.
2. Switch off the access point while the DK is running. Add and remove weight. Adjust the humidity thresholds from the serial shell so the measured humidity is first above the on threshold, then below the off threshold. Verify that serial readings continue to change and that the physical fan follows the commands.
3. With the access point still off, reboot the DK and repeat the scale and fan checks. Restore the access point and compare incoming cloud readings with the current serial output. Restore the original humidity thresholds.

## Verify a signed firmware update

1. Flash version N to the test DK. Run `mflt get_device_info` and record the software version, software type, hardware version, and device ID. Record the current spool ID, calibration, and a set of serial readings.
2. Increment `mvp_firmware/VERSION` for N+1 and repeat the cloud build with the same team signing key. The application version is derived from that file. From the repository root, verify the signed image:

   ```sh
   python "$ZEPHYR_BASE/../bootloader/mcuboot/scripts/imgtool.py" verify \
     -k firmware/keys/dryspool-signing.pem \
     build-wifi-box/mvp_firmware/zephyr/zephyr.signed.bin
   ```

3. In the target cloud project, upload `build-wifi-box/mvp_firmware/zephyr/zephyr.signed.bin` as the release payload and `build-wifi-box/mvp_firmware/zephyr/zephyr.elf` from the same build for debug symbols. Use these MVP paths in the team guide’s upload examples. Create the N+1 release with the software and hardware identifiers reported by the test DK, then deploy it to a cohort containing only that board. A, B and C use the same software type `dryspool-wifi-box` and hardware type `nrf7002dk-rev1`. Check cohort membership by serial before activation. [Release upload commands](../docs/TEAM_SETUP_AND_DEMO.md#6-publish-a-new-fota-release)
4. The device checks for updates periodically. For a manual check, run `mflt get_latest_url` in the UART shell, then `mflt get_latest_release` to download the available release. Watch the HTTPS download, reboot, MCUboot image validation, and application startup. Record the confirmation log. The trial image confirms once settings load, both the BME280 readings and raw NAU7802 counts are valid, and the fan GPIO command succeeds. Confirmation works offline and before scale calibration. If the image is still unconfirmed at the next reset, MCUboot rolls back.
5. Run `mflt get_device_info` to confirm N+1. Reboot once more, check that the version and calibration persist, and compare the live serial readings with cloud telemetry.
