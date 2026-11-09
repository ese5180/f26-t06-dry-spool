# DrySpool team setup and FOTA demo

Use this guide to set up a teammate's PC, add another nRF7002 DK, publish a
firmware release, and run the classroom demo.

## 1. Shared project configuration

| Item | Value |
| --- | --- |
| Branch | `wireless-update` |
| NCS | `3.4.0` |
| Board | `nrf7002dk/nrf5340/cpuapp/ns` |
| Organization | `zicong-zhang` |
| Project | `default-project` |
| Software type | `dryspool-app` |
| Hardware version | `nrf7002dk-rev1` |
| Default cohort | `default` |

Shared between teammates:

- `firmware/keys/dryspool-signing.pem`: firmware signing key;
- Memfault/nRF Cloud Project Key: placed in `firmware/local.conf`.

Unique for every physical board:

- device ID;
- TLS certificate and private key;
- J-Link serial number and COM ports.

Share the signing key through a team-only Google Drive folder. Keep the project
CA private key restricted to the person provisioning devices. Never store an
Organization Auth Token (OAT) in Drive or Git.

## 2. Teammate workstation setup

1. Install nRF Connect for Desktop and NCS **3.4.0** from Toolchain Manager.
2. Open an **NCS 3.4.0 terminal**. A standalone Zephyr terminal will not have
   the correct `/ns` board target.
3. Clone and select the branch:

   ```powershell
   git clone https://github.com/ese5180/f26-t06-dry-spool.git
   cd f26-t06-dry-spool
   git switch main
   git pull --ff-only origin main
   ```

4. Download `dryspool-signing.pem` from the restricted Drive folder and place
   it at:

   ```text
   firmware/keys/dryspool-signing.pem
   ```

5. Create the local cloud configuration. The repository has no example file,
   so create `firmware/local.conf` yourself with this single line:

   ```text
   CONFIG_MEMFAULT_NCS_PROJECT_KEY="<PROJECT_KEY>"
   ```

   Replace `<PROJECT_KEY>` with the active key from **nRF Cloud → Project
   Settings → Project Keys** (keep the quotes). From PowerShell:

   ```powershell
   Set-Content -Path firmware\local.conf -Value 'CONFIG_MEMFAULT_NCS_PROJECT_KEY="<PROJECT_KEY>"'
   ```

6. Confirm both secret files are ignored:

   ```powershell
   git check-ignore firmware/keys/dryspool-signing.pem firmware/local.conf
   ```

## 3. Build and flash

Connect the DK and identify its J-Link serial number:

```powershell
nrfutil device list
```

Build from the firmware directory:

```powershell
cd firmware
west build --pristine --sysbuild `
  -b nrf7002dk/nrf5340/cpuapp/ns `
  . `
  -d ..\build-dryspool `
  -- '-DEXTRA_CONF_FILE=coap.conf;coap-fota.conf;local.conf'
```

Flash the selected board:

```powershell
west flash -d ..\build-dryspool --dev-id <JLINK_SERIAL>
```

Release files:

```text
build-dryspool/firmware/zephyr/zephyr.signed.bin
build-dryspool/firmware/zephyr/zephyr.elf
```

Open the application UART at 115200 baud. COM9 was the application shell on
the first DK, but each teammate must check their own COM-port assignment.

## 4. Add a new DK to nRF Cloud

Repeat this section for every new physical board. Do not copy another board's
TLS credentials.

### Install the provisioning tools

```powershell
New-Item -ItemType Directory -Force C:\DrySpool-secrets\nrfcloud
cd C:\DrySpool-secrets\nrfcloud
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install nrfcloud-utils==3.3.1 memfault-cli==1.12.1
```

The provisioning lead supplies the existing team CA certificate and CA private
key. Do not create a different CA for each device.

### Install credentials on the board

Flash the DrySpool firmware first, then close any program using the application
COM port.

```powershell
$deviceDir = 'C:\DrySpool-secrets\nrfcloud\devices\<BOARD_LABEL>'
New-Item -ItemType Directory -Force $deviceDir

device_credentials_installer `
  --port <APPLICATION_COM_PORT> `
  --cmd-type tls_cred_shell `
  --local-cert `
  --ca 'C:\DrySpool-secrets\nrfcloud\<TEAM_CA_CERT>.pem' `
  --ca-key 'C:\DrySpool-secrets\nrfcloud\<TEAM_CA_PRIVATE_KEY>.pem' `
  --coap `
  --verify `
  --save `
  --path $deviceDir `
  --csv "$deviceDir\onboard.csv" `
  --plain
```

Verification must pass and `onboard.csv` must be created.

### Create the cloud record

Create a temporary OAT in nRF Cloud and enter it without placing the literal
token in command history:

```powershell
$env:DRYSPOOL_OAT = Read-Host 'Temporary Organization Auth Token' -MaskInput

nrfcloud `
  --org-token $env:DRYSPOOL_OAT `
  --org zicong-zhang `
  --project default-project `
  device create `
  --csv "$deviceDir\onboard.csv" `
  --res "$deviceDir\onboard-results.csv"

Remove-Item Env:\DRYSPOOL_OAT
```

Confirm that the result CSV reports `OK` and the device appears in the cloud.
Revoke the temporary OAT after provisioning.

### Configure Wi-Fi

Reopen the application UART and run:

```text
wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD
wifi cred auto_connect
```

For demos, use a WPA2-Personal hotspot without a captive portal. Successful
logs include DHCP, authorization result `2.01`, and `Connected to nRF Cloud`.
An initial SNTP `-116` warning is harmless if the cloud connection follows.

## 5. Device acceptance test

Run on the application UART:

```text
mflt get_device_info
mflt test heartbeat
mflt post_chunks
mflt get_latest_url
```

Confirm:

- the device ID is unique and matches the cloud record;
- software type is `dryspool-app`;
- hardware is `nrf7002dk-rev1`;
- the expected version is reported;
- Memfault data posts successfully; and
- all four DrySpool telemetry values appear in the cloud.

The current build disables the extra button thread to save RAM, so BUTTON2 does
not trigger FOTA. Use:

```text
mflt get_latest_release
```

For multiple devices, keep a non-secret inventory containing board label,
owner, J-Link serial, device ID, cohort, and firmware version. Upload each
firmware release once, then deploy it to a cohort rather than per device.

## 6. Publish a new FOTA release

1. Increment the version in both `firmware/VERSION` and the `APP_VERSION`
   default in `firmware/Kconfig`.
2. Build pristine with the same team signing key.
3. Verify the signed image:

   ```powershell
   python $env:ZEPHYR_BASE\..\bootloader\mcuboot\scripts\imgtool.py `
     verify `
     -k .\firmware\keys\dryspool-signing.pem `
     .\build-dryspool\firmware\zephyr\zephyr.signed.bin
   ```

4. Set a temporary OAT, then upload symbols and firmware:

   ```powershell
   $env:DRYSPOOL_OAT = Read-Host 'Temporary Organization Auth Token' -MaskInput

   nrfcloud --org-token $env:DRYSPOOL_OAT --org zicong-zhang --project default-project `
     upload-mcu-symbols `
     --software-type dryspool-app `
     --software-version '<NEW_VERSION>' `
     --revision '<GIT_COMMIT>' `
     .\build-dryspool\firmware\zephyr\zephyr.elf

   nrfcloud --org-token $env:DRYSPOOL_OAT --org zicong-zhang --project default-project `
     upload-ota-payload `
     --hardware-version nrf7002dk-rev1 `
     --software-type dryspool-app `
     --software-version '<NEW_VERSION>' `
     --revision '<GIT_COMMIT>' `
     --notes '<RELEASE_NOTES>' `
     .\build-dryspool\firmware\zephyr\zephyr.signed.bin
   ```

5. Deploy to the test cohort first (`deepa-test` holds one test board):

   ```powershell
   nrfcloud --org-token $env:DRYSPOOL_OAT --org zicong-zhang --project default-project `
     deploy-release --release-version '<NEW_VERSION>' --cohort deepa-test --rollout-percent 100

   Remove-Item Env:\DRYSPOOL_OAT
   ```

For the classroom demo, upload the release beforehand but do not activate it
until the demo. Periodic update checking could otherwise update the board early.

## 7. Classroom demo walkthrough

Prepare a DK running version **N** and upload—but do not activate—version
**N+1**.

1. Show the current version:

   ```text
   mflt get_device_info
   ```

2. Show the recurring DrySpool UART readings and cloud telemetry. Explain that
   telemetry uses nRF Cloud CoAP/DTLS over Wi-Fi.
3. Explain the secure path: the application downloads into external flash;
   MCUboot verifies the ECDSA-P256 signature and hash before booting it.
4. Before activation, run `mflt get_latest_url` and show `Up to date!`.
5. Activate version N+1 for the demo device's cohort.
6. Trigger the OTA update:

   ```text
   mflt get_latest_release
   ```

7. Point out the download, reboot, MCUboot swap, and
   `Confirming FOTA update image` log. Do not unplug or reset during download.
8. After the cloud reconnects, run:

   ```text
   mflt get_device_info
   mflt test heartbeat
   mflt post_chunks
   ```

9. Show version N+1 locally and in the cloud.
10. Reset the board once, then run `mflt get_device_info` again. It must remain
    on N+1, proving confirmation and no rollback.
11. Run `mflt get_latest_url` again and show `Up to date!`.

Briefly explain the failure cases:

- a corrupt or foreign-key image is rejected;
- an interrupted download leaves the current image bootable;
- an unconfirmed crashing image rolls back on the next boot; and
- loss of Wi-Fi delays cloud operations without stopping local sensing.

## 8. Before pushing

```powershell
git status --short
git check-ignore firmware/local.conf firmware/keys/dryspool-signing.pem
```

Never commit the signing key, `local.conf`, an OAT, the project CA private key,
Wi-Fi credentials, or device private keys.

Official references:

- [Device onboarding](https://docs.nrfcloud.com/docs/nrfcloud/device-onboarding)
- [MCU OTA releases](https://docs.nrfcloud.com/docs/mcu/releases-integration-guide)
