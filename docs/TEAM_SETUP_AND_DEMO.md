# DrySpool team setup, multi-device provisioning, and demo runbook

This is the repeatable process for every teammate and every nRF7002 DK. It is
written for Windows, nRF Connect SDK (NCS) 3.4.0, PowerShell, and the
`wireless-update` branch.

## 1. Fixed project values

Use these exact values unless the team deliberately changes the cloud project
or hardware platform:

| Item | Value |
| --- | --- |
| Git branch | `wireless-update` |
| NCS version | `3.4.0` |
| Board target | `nrf7002dk/nrf5340/cpuapp/ns` |
| Cloud organization slug | `zicong-zhang` |
| Cloud project slug | `default-project` |
| Software type | `dryspool-app` |
| Hardware version | `nrf7002dk-rev1` |
| Initial cohort | `default` |
| nRF Cloud TLS security tag | `16842753` |
| Application UART | `COM9` on the first tested DK; verify on every PC |

Do not copy the first board's device ID or TLS credential files to another
board. Each device must have its own hardware-derived ID, certificate, and
private key.

## 2. Understand the five credentials

These files and tokens have different purposes:

| Credential | Shared? | Where it belongs | Git? |
| --- | --- | --- | --- |
| `dryspool-signing.pem` | Same for all team firmware builders and devices | `firmware/keys/` | Never |
| Memfault/nRF Cloud Project Key | Same project value in every build | `firmware/local.conf` | Never |
| Organization Auth Token (OAT) | Prefer one temporary token per provisioning/release operator | Environment variable only | Never |
| Project CA private key | Provisioning lead only | Restricted secret storage | Never |
| Device TLS private key/certificate | Unique to one physical board | Installed in that board's protected storage | Never |

The Google Drive copy of `dryspool-signing.pem` must be team-restricted, not
public or "anyone with the link." Keep the project CA private key in a separate,
more restricted folder. A teammate who only builds firmware does not need the
CA private key or an OAT.

Because an OAT grants cloud-management access, never paste it into source code,
screenshots, issues, chat transcripts, or a shell command that will remain in
history. Revoke temporary OATs after provisioning or publishing.

Suggested restricted Drive layout:

```text
DrySpool Secrets/
├── firmware-builders/
│   ├── dryspool-signing.pem
│   └── PROJECT_KEY.txt
└── provisioning-leads/
    ├── TEAM_CA_CERT.pem
    └── TEAM_CA_PRIVATE_KEY.pem
```

Do not store an OAT in Drive. Do not put generated per-device private keys in a
team-wide folder.

## 3. One-time workstation setup

1. Install nRF Connect for Desktop and Toolchain Manager.
2. Install NCS **3.4.0** and its matching toolchain.
3. Install the nRF Connect for VS Code extension if using VS Code.
4. Clone the repository and select the shared branch:

   ```powershell
   git clone https://github.com/ese5180/f26-t06-dry-spool.git
   cd f26-t06-dry-spool
   git switch wireless-update
   git pull --ff-only origin wireless-update
   ```

5. Open an **NCS 3.4.0 terminal** from Toolchain Manager. Do not build from a
   standalone Zephyr workspace. If CMake says the `/ns` board qualifier does
   not exist, the terminal is using the wrong Zephyr/NCS installation.

## 4. Install the two build secrets

From the repository root:

1. Download the team's `dryspool-signing.pem` from the restricted Drive folder
   and place it at:

   ```text
   firmware/keys/dryspool-signing.pem
   ```

2. Copy the local configuration template:

   ```powershell
   Copy-Item firmware\local.conf.example firmware\local.conf
   ```

3. In nRF Cloud, open **Project Settings → Project Keys**, copy the active
   project key, and replace the placeholder in `firmware/local.conf`.
4. Verify that neither secret can be committed:

   ```powershell
   git check-ignore firmware/keys/dryspool-signing.pem firmware/local.conf
   git status --short
   ```

Both paths must be reported as ignored. Never use `git add -f` on them.

The expected MCUboot public-key hash for the shared signing key is:

```text
c2b949a288d26410f3af503c6973fd932b72546a3b011f308fc80729b70373e4
```

After building, `imgtool.py dumpinfo` on `zephyr.signed.bin` should show the
same `KEYHASH` value.

## 5. Build and flash the common firmware

Connect one nRF7002 DK, then list its J-Link serial number and COM ports:

```powershell
nrfutil device list
```

Build from `firmware/` in the NCS 3.4.0 terminal:

```powershell
cd firmware
west build --pristine --sysbuild `
  -b nrf7002dk/nrf5340/cpuapp/ns `
  . `
  -d ..\build-dryspool `
  -- '-DEXTRA_CONF_FILE=coap.conf;coap-fota.conf;local.conf'
```

Flash MCUboot, TF-M, and the application. Supplying `--dev-id` avoids flashing
the wrong DK when several boards are connected:

```powershell
west flash -d ..\build-dryspool --dev-id <JLINK_SERIAL>
```

Release files are generated here:

```text
build-dryspool/firmware/zephyr/zephyr.signed.bin
build-dryspool/firmware/zephyr/zephyr.elf
```

Open the application UART at 115200 baud. On the first tested board it was
COM9; the other J-Link UART (COM10 on that machine) carried TF-M output and was
not the DrySpool shell.

## 6. Provision one new physical device

Repeat this entire section for every new DK. Firmware signing is shared, but
cloud identity is per-device.

### 6.1 Install the host tools

Create a secret working directory outside the repository:

```powershell
New-Item -ItemType Directory -Force C:\DrySpool-secrets\nrfcloud
cd C:\DrySpool-secrets\nrfcloud
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install nrfcloud-utils==3.3.1 memfault-cli==1.12.1
```

Use the team's existing project CA certificate and CA private key. Do not create
a new CA for each board. The provisioning lead should either perform this step
or provide the CA files through the restricted provisioning folder.

### 6.2 Install unique TLS credentials on the board

First flash the common firmware so the TLS credential shell is available.
Close VS Code's COM9 terminal before running the installer; only one program
can own the COM port.

Create a separate directory for the board, then run:

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

Expected outcome:

- a unique device ID is printed;
- CA, client certificate, and private key installation passes verification;
- `onboard.csv` is created for that device; and
- the device credentials use security tag `16842753`.

Do not use `--delete` on an existing device unless reprovisioning was planned
and its exact security tag was checked first.

### 6.3 Create the cloud device record

In nRF Cloud, create a temporary Organization Auth Token with only the access
needed for device provisioning. Put it in a temporary environment variable so
the literal token is not stored in command history:

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

The result CSV must show `OK`. Confirm that the device appears in the `default`
cohort before continuing. Revoke the temporary OAT when the provisioning batch
is complete.

After the board connects successfully, delete any host-generated per-device
private-key copy according to the team's credential-retention policy. The key
installed in protected storage is the operational copy. Keep the public
certificate, device ID, and non-secret inventory data. Do not delete or lose
the project CA private key or firmware-signing key.

### 6.4 Configure Wi-Fi locally

Reopen the application UART and configure a WPA2-Personal network:

```text
wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD
wifi cred auto_connect
```

Use a phone hotspot or dedicated WPA2-Personal access point for demos. Avoid
networks with a captive portal; university enterprise Wi-Fi may require a
different supplicant configuration.

Successful startup includes:

```text
Connected
Received: <DHCP_ADDRESS>
Authorization result_code: 2.01
Authorized
Connected to nRF Cloud
```

An initial `sntp_query, error: -116` is nonfatal if authorization and cloud
connection follow it.

## 7. Per-device acceptance test

Run these commands in the application UART shell:

```text
mflt get_device_info
mflt test heartbeat
mflt post_chunks
mflt get_latest_url
```

Check all of the following:

- the device ID is unique and matches the cloud record;
- software type is `dryspool-app`;
- hardware version is `nrf7002dk-rev1`;
- the expected software version is reported;
- posting data succeeds; and
- the cloud shows temperature, humidity, filament mass, and dehumidifier state.

The current build sets `CONFIG_SAMPLE_MEMFAULT_BUTTONS=n` to stay within the
nRF5340 RAM limit. `BUTTON2` does not trigger FOTA. Always use the UART command
`mflt get_latest_release`.

Record only non-secret inventory information:

| Board label | Owner | J-Link S/N | Device ID | Cohort | Version | Acceptance date |
| --- | --- | --- | --- | --- | --- | --- |
| Example: DK-01 | Teammate | `<serial>` | `<device-id>` | `default` | `0.1.1+0` | YYYY-MM-DD |

## 8. Scaling to many devices

For each additional DK:

1. Flash the same MCUboot/application build and signing root of trust.
2. Generate and install a new device certificate and private key.
3. Create a separate cloud record using that board's `onboard.csv`.
4. Configure Wi-Fi and run the acceptance test.
5. Add the board to the non-secret inventory.

Do not rebuild or upload a release separately for each device. A release is
uploaded once for the shared software type/hardware version and then assigned
to a cohort. Before a larger rollout, create a small `canary` cohort with one
known-good board; update it first, observe it, and then deploy to `default`.

## 9. Build and publish a new FOTA release

### 9.1 Version and build

Increment the version in both `firmware/VERSION` and the `APP_VERSION` default
in `firmware/Kconfig`. Never reuse a released version number. Build pristine
with the same team signing key, then verify the artifact:

```powershell
python $env:ZEPHYR_BASE\..\bootloader\mcuboot\scripts\imgtool.py `
  verify `
  -k .\firmware\keys\dryspool-signing.pem `
  .\build-dryspool\firmware\zephyr\zephyr.signed.bin
```

Save the release version, Git commit, file size, and SHA-256 hash:

```powershell
Get-FileHash .\build-dryspool\firmware\zephyr\zephyr.signed.bin -Algorithm SHA256
```

### 9.2 Upload symbols and payload

Set a temporary OAT as in the provisioning section, then run from the
repository root. Replace the bracketed values:

```powershell
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
  --notes '<SHORT_RELEASE_NOTES>' `
  .\build-dryspool\firmware\zephyr\zephyr.signed.bin
```

Upload the release before class, but do **not** activate it while the demo board
is online. Periodic FOTA checking is enabled, so early activation could update
the board before the demonstration.

### 9.3 Activate the rollout

Start with the canary cohort when available:

```powershell
nrfcloud --org-token $env:DRYSPOOL_OAT --org zicong-zhang --project default-project `
  deploy-release --release-version '<NEW_VERSION>' --cohort canary --rollout-percent 100
```

After validation, deploy to `default`:

```powershell
nrfcloud --org-token $env:DRYSPOOL_OAT --org zicong-zhang --project default-project `
  deploy-release --release-version '<NEW_VERSION>' --cohort default --rollout-percent 100
```

Clear and revoke the temporary token after the release work:

```powershell
Remove-Item Env:\DRYSPOOL_OAT
```

## 10. Classroom demo walkthrough

### Before class

1. Keep the demo DK on version **N** and confirm it connects to the prepared
   hotspot automatically.
2. Build, sign, verify, and upload version **N+1**, including its ELF symbols,
   but do not activate it.
3. Keep the DK powered, COM9 open at 115200 baud, the device page open in nRF
   Cloud, and the release page ready to activate.
4. Have the hotspot powered and charging. Keep the USB cable connected to a
   stable power source.
5. Save screenshots of the successful prior test as evidence, but perform the
   update live.

### Live sequence

1. **Show the old version.** Run:

   ```text
   mflt get_device_info
   ```

   Point out device ID, `dryspool-app`, version N, and
   `nrf7002dk-rev1`.

2. **Show product wireless behavior.** Point to the recurring DrySpool UART
   readings and the four cloud values. Explain that telemetry uses authenticated
   nRF Cloud CoAP/DTLS over Wi-Fi.

3. **Show the secure boot chain.** Explain that MCUboot contains only the team
   public key; `dryspool-signing.pem` never enters Git or the device. The update
   is staged in the external MX25R64 slot and its ECDSA-P256 signature and
   SHA-256 hash are checked before boot.

4. **Prove no update is available yet.** Run:

   ```text
   mflt get_latest_url
   ```

   It should report `Up to date!` before activation.

5. **Activate N+1.** Activate the prepared release for the demo device's cohort
   in nRF Cloud/Memfault.

6. **Trigger the wireless update.** Run on COM9:

   ```text
   mflt get_latest_release
   ```

   Do not press BUTTON2. Do not reset or unplug the board during download.

7. **Narrate the transition.** Point out the update lookup, HTTPS download,
   external-flash staging, reboot, MCUboot validation/swap, and the
   `Confirming FOTA update image` application log.

8. **Show the new version and cloud reporting.** After reconnection, run:

   ```text
   mflt get_device_info
   mflt test heartbeat
   mflt post_chunks
   ```

   Confirm version N+1 locally, then refresh the cloud device page and show the
   same version there.

9. **Prove confirmation survives reboot.** Press the board reset button once or
   run:

   ```powershell
   nrfutil device reset --serial-number <JLINK_SERIAL> --core application
   ```

   Run `mflt get_device_info` again. It must still report N+1, demonstrating
   that the image was confirmed and did not roll back.

10. **Show the completed state.** Run `mflt get_latest_url` again; it should
    report `Up to date!`.

### Demo explanation of failure cases

- A corrupt or foreign-key image is rejected by MCUboot; the known-good image
  remains bootable.
- An interrupted download is never marked pending, so slot 0 keeps running.
- A new image that crashes before confirmation is reverted by MCUboot on the
  following boot.
- Loss of Wi-Fi delays cloud/FOTA work but does not stop local sensing and
  dehumidifier logic.
- An early SNTP `-116` warning is acceptable when valid network time and cloud
  authorization follow it.

### Evidence to capture

- old and new `mflt get_device_info` output;
- activated release and cohort;
- download/reboot/confirmation log;
- cloud telemetry and updated version;
- post-update reset showing no rollback; and
- final `Up to date!` result.

## 11. Final security checks

Before pushing any work:

```powershell
git status --short
git check-ignore firmware/local.conf firmware/keys/dryspool-signing.pem
git grep -n -E 'oat_[A-Za-z0-9_-]+' -- . ':!docs/TEAM_SETUP_AND_DEMO.md'
```

The first command must not show a secret file, both secret paths must be
ignored, and the tracked-source token search must return no real token.

If any credential was pasted into chat, an issue, or a terminal screenshot,
revoke or rotate it before treating the setup as complete.

## 12. Official references

- [nRF Cloud device onboarding](https://docs.nrfcloud.com/docs/nrfcloud/device-onboarding)
- [MCU OTA release integration](https://docs.nrfcloud.com/docs/mcu/releases-integration-guide)
- [Uploading MCU symbols with the CLI](https://docs.nrfcloud.com/docs/ci/cli/upload-mcu-symbols)
- [Memfault symbol build IDs](https://docs.nrfcloud.com/docs/mcu/symbol-file-build-ids)
