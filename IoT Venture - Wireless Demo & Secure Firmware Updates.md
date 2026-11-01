# IoT Venture: Wireless Demo & Secure Firmware Updates

**Team:** T06 — DrySpool  
**Members:** Sirui Wu, Zicong Zhang, Deepa Lokesha  
**Repository:** https://github.com/ese5180/f26-t06-dry-spool  
**Platform:** nRF7002 DK, nRF Connect SDK 3.4.0 / Zephyr  
**Board target:** `nrf7002dk/nrf5340/cpuapp/ns`  
**Local verification date:** November 2, 2026  
**FOTA result:** Verified wireless update from `0.1.0+0` to `0.1.1+0` on device `3D01A0FA7D2FBAB1`.

## Q1. Draw and describe your bootloading process

### Boot and update process

DrySpool uses MCUboot to boot signed application images. The application handles Wi-Fi connectivity, product telemetry, and firmware downloads. MCUboot handles image validation, installation, test boot, and rollback of an unconfirmed update.

```text
Power on / reset
       |
       v
MCUboot in internal flash
       |
       +-- No pending update --> Validate and boot current application
       |
       +-- Pending update --> Check candidate hash and ECDSA signature
                                      |
                       +--------------+----------------+
                       |                               |
                    Invalid                          Valid
                       |                               |
                 Reject candidate             Swap candidate into slot 0
                 Retain valid image           Preserve old image for rollback
                                                       |
                                                Boot in test mode
                                                       |
                              +------------------------+------------------+
                              |                                           |
                       Application confirms                       Not confirmed
                              |                                           |
                       Retain new version                  Revert on subsequent reset

Running DrySpool application
       |
       +-- Wi-Fi + CoAP/DTLS --> Product telemetry to nRF Cloud
       |
       +-- HTTPS release check --> Download signed firmware to external slot 1
                                                    |
                                           Mark pending and reboot
                                                    |
                                                    +--> MCUboot
```

The initial installation of MCUboot and the application uses the USB debug probe. Subsequent FOTA updates are downloaded by the running application over Wi-Fi. USB flashing is not used to demonstrate the wireless update itself.

### Bootloader and application sizes

| Component | Size | Measurement context |
| --- | ---: | --- |
| MCUboot | 39,308 bytes (approximately 38.4 KiB) | Team's documented clean `0.1.0` build; 64 KiB reserved partition |
| TF-M secure application | 130,008 bytes (approximately 127.0 KiB) | Team's documented clean `0.1.0` build |
| DrySpool non-secure application FLASH usage | 728,024 bytes (approximately 711.0 KiB) | Local `0.1.1` build with the Wi-Fi MAC logging change |
| DrySpool application RAM usage | 393,836 bytes | Same local build; 400 KiB region |
| Earlier local signed build | 859,247 bytes (approximately 839.1 KiB) | Previously built local `0.1.1` image with MAC logging; not the cloud payload downloaded in the FOTA test |
| Downloaded FOTA payload | 858,974 bytes (approximately 838.8 KiB) | Actual `0.1.1+0` cloud payload; serial log records a complete download |
| Primary and secondary image slots | 896 KiB each | Internal execution slot and external download slot |

Program size, signed-file size, and reserved partition capacity are distinct measurements. The complete update contains the secure and non-secure application components and signing metadata. The MCUboot and TF-M figures above are repository baseline measurements, not new measurements of those components during this session.

### Who downloads the firmware?

The **application**, not MCUboot, maintains the network connection and downloads the firmware. Memfault release management and the NCS FOTA downloader retrieve the payload and write it progressively to external flash. After a successful download, the update is scheduled and the application reboots. MCUboot then processes the pending image.

### Wireless protocol and selection rationale

Firmware updates use **HTTPS over Wi-Fi**. This reuses the product's network connection and supports the approximately 840 KiB image without requiring a phone to relay the update. Product telemetry uses **CoAP/DTLS** to nRF Cloud, while the NCS 3.4.0-compatible Memfault integration uses **HTTPS** for diagnostic uploads, release checks, and firmware downloads. BLE is not used for FOTA in this implementation.

### Image storage

Downloaded firmware is staged in the **896 KiB secondary slot (slot 1)** in the DK's external **MX25R64 QSPI flash**. The external flash has a total capacity of 8 MiB. The active image runs from **primary slot 0** in nRF5340 internal flash. Equal-sized slots support the configured MCUboot swap-using-move update process.

### Firmware authenticity and failure handling

The team signs firmware with its ECDSA-P256 private key. MCUboot contains the corresponding public key and verifies the image hash and signature before accepting an update. The private signing key is excluded from Git. Firmware-signing credentials are separate from the device certificate and private key used for cloud authentication.

| Failure case | Implemented handling and limitations |
| --- | --- |
| Wrong signature | Reject an image that cannot be verified against the trusted public key. |
| Corrupted download | Hash and signature validation detect changes to the signed image. |
| Interrupted download | Stage the candidate in external flash; do not schedule an unsuccessful transfer as a completed update. |
| New application fails before confirmation | Leave the image unconfirmed so MCUboot can revert on a subsequent reset. A hung application still requires a reset to reach MCUboot. |
| Defect after confirmation | Automatic trial rollback no longer applies. Diagnostics and a corrective release are required. |

The application calls `boot_write_img_confirmed()` after `dryspool_sensors_init()` succeeds. The current sensor backend is simulated and its initialization returns success; this is a minimal startup gate, not a comprehensive hardware or application health test. Successful confirmation does not prove that the firmware is bug-free.

## Q2. Implement FOTA updates on your existing codebase from the Wireless Demo section

### Repository and implementation

**Submitted code repository:** https://github.com/ese5180/f26-t06-dry-spool

**Remote implementation snapshot:** https://github.com/ese5180/f26-t06-dry-spool/tree/f0df5fafddadfaba92d317e4c89effc31c244a0e

The common DrySpool firmware integrates product telemetry, MCUboot, signed images, external-flash staging, and wireless update support in one Zephyr project. It is based on Nordic's Wi-Fi/nRF Cloud sample and adapted to NCS 3.4.0. A local preparation build additionally printed the station-interface MAC for campus network registration; that logging change is not included in the linked remote snapshot. The subsequently installed cloud release identifies its application build as `0.1.1-2d024d1f034c`.

| Assignment requirement | Implementation |
| --- | --- |
| MCUboot support in Zephyr | `firmware/Kconfig.sysbuild` selects MCUboot; bootloader configuration supports test/confirm behavior. |
| External-flash firmware storage | Application and MCUboot board overlays define the external secondary slot. |
| Uniquely generated signing key | `firmware/sysbuild.conf` selects the team's ECDSA-P256 key; private material remains outside version control. |
| Wireless FOTA | `firmware/coap-fota.conf` enables release checking and downloading; `firmware/src/memfault_fota_support.c` handles download completion and image confirmation. |

### Results observed on Sirui's board

The board reports device ID `3D01A0FA7D2FBAB1`, software type `dryspool-app`, and hardware version `nrf7002dk-rev1`. Preliminary setup used a USB-installed `0.1.1` build. For the actual FOTA demonstration, the board ran `0.1.0+0` before downloading and booting the cloud release `0.1.1+0`.

**1. Preliminary host-side image validation and boot**

`imgtool verify` successfully validated the locally built signed image:

```text
Image was correctly validated
Image version: 0.1.1+0
```

After USB installation, MCUboot booted the application from the primary slot:

```text
Image version: v0.1.1
Jumping to the first image slot
DrySpool firmware started, version: 0.1.1, cloud protocol: CoAP
```

**2. Device credentials and network connection**

Device credentials were installed and verified, and an onboarding CSV matching the firmware's device ID was supplied to the organization owner for cloud registration. On reboot, the firmware reported:

```text
Sec Tag: 16842753; CA: Yes, Client Cert: Yes, Private Key: Yes
Network connectivity gained!
Network is ready
```

The board joined the campus `AirPennNet-Device` network and obtained an IPv4 address through DHCP. No network passwords, project keys, or private keys are included in this submission.

**3. Authenticated nRF Cloud connection and product application**

The observed CoAP/DTLS authorization completed successfully:

```text
Request authorization with JWT
Authorization result_code: 2.01
Authorized
DTLS CID is active
Connected to nRF Cloud
DrySpool: 23.0 C, 42.0 %RH, 750.0 g, dehumidifier off
```

The application continued generating periodic DrySpool readings. The code sends temperature, humidity, remaining-filament mass, and dehumidifier-state messages. These values are deterministic simulated data, not physical sensor measurements. The supplied logs establish connection and application activity; they do not independently show a cloud dashboard receipt for every product message.

**4. Preliminary Memfault diagnostic upload and release query**

The following commands were run from the application UART shell:

```text
mflt test heartbeat
mflt post_chunks
mflt get_latest_url
```

Observed output:

```text
Triggering Heartbeat
Posting Memfault Data
Data posted successfully, 218 bytes sent
Checking for update over HTTPS
Up to date!
```

This preliminary check verified diagnostic HTTPS upload and the no-update release-query path. The subsequent two-version FOTA demonstration is documented below.

### End-to-end FOTA demonstrated on Sirui's board

The supplied serial trace records a complete wireless update from `0.1.0+0` to `0.1.1+0` on the same device. The following excerpts omit the temporary signed download URL and its access token.

**1. Confirm the running version and request the release**

```text
mflt get_device_info
S/N: 3D01A0FA7D2FBAB1
SW type: dryspool-app
SW version: 0.1.0+0
HW version: nrf7002dk-rev1

mflt get_latest_url
Checking for update over HTTPS
Download URL: [temporary signed URL omitted]

mflt get_latest_release
FOTA In Progress
```

The version query establishes the pre-update state. The running application then retrieved an available cloud release and started its HTTPS download; this transition was not performed with `west flash`.

**2. Download the complete image and schedule installation**

```text
[00:01:29.645,233] <inf> downloader: Failed to connect on IPv6 (err -116), attempting IPv4
[00:03:22.407,379] <inf> downloader: Downloaded 858974/858974 bytes (100%)
[00:03:22.432,464] <inf> dfu_target_mcuboot: MCUBoot image-0 upgrade scheduled. Reset device to apply
[00:03:22.432,464] <inf> memfault_fota_support: FOTA update downloaded, rebooting to apply it
[00:03:22.940,490] <inf> sample_reboot: Rebooting in 10s...
```

The initial IPv6 connection attempt timed out, but the downloader fell back to IPv4 and completed all **858,974 bytes**. The application continued producing periodic DrySpool readings during the transfer. It then disconnected from nRF Cloud and initiated a software reset to apply the update.

**3. MCUboot installs the candidate and the application confirms it**

```text
I: Secondary image: magic=good, swap_type=0x2, copy_done=0x3, image_ok=0x3
I: Image index: 0, Swap type: test
I: Starting swap using move algorithm.
I: Image version: v0.1.1
I: Jumping to the first image slot
*** Booting My Application v0.1.1-2d024d1f034c ***
[00:00:00.285,369] <inf> memfault_fota_support: Confirming FOTA update image
```

These lines demonstrate that MCUboot processed the downloaded candidate as a test update, performed the configured swap, and booted version `0.1.1`. The application entered its image-confirmation path, and the supplied log contains no confirmation-failure message.

**4. Verify the updated version, cloud reconnection, and diagnostic upload**

```text
[00:00:28.076,416] <inf> nrf_cloud_coap_transport: Authorization result_code: 2.01
[00:00:28.076,904] <inf> nrf_cloud_coap_transport: Authorized
[00:00:28.190,856] <inf> cloud_connection: Connected to nRF Cloud
[00:00:28.191,101] <inf> application: DrySpool: 23.0 C, 42.0 %RH, 750.0 g, dehumidifier off

mflt get_device_info
S/N: 3D01A0FA7D2FBAB1
SW type: dryspool-app
SW version: 0.1.1+0
HW version: nrf7002dk-rev1

mflt test heartbeat
Triggering Heartbeat
mflt post_chunks
[00:01:06.367,340] <inf> mflt: Data posted successfully, 214 bytes sent
```

The device retained its identity across the update, reconnected to Wi-Fi and nRF Cloud, resumed product application activity, reported the new version, and successfully posted diagnostics. Together, the pre-update version, complete wireless download, MCUboot swap, and post-update version establish successful end-to-end FOTA on this board.

### Verification scope

| Check | Evidence from this session |
| --- | --- |
| Pre-update version `0.1.0+0` | Confirmed by `mflt get_device_info` |
| HTTPS firmware download | 858,974 / 858,974 bytes received |
| MCUboot test swap | Explicit `Swap type: test` and move-algorithm logs |
| New application version `0.1.1+0` | Boot banner and post-update device-info query |
| Application image confirmation | Confirmation log, with no reported confirmation error |
| Post-update cloud authentication | CoAP authorization `2.01`, followed by connected state |
| Post-update diagnostics | 214-byte upload succeeded |
| Confirmation persistence after a second manual reset | Not included in the supplied trace |
| Post-update cloud dashboard version | Not independently shown in the supplied trace |
| Invalid-signature rejection or faulty-image rollback | Not exercised in this local demonstration |

The team's earlier [firmware verification record](https://github.com/ese5180/f26-t06-dry-spool/blob/f0df5fafddadfaba92d317e4c89effc31c244a0e/firmware/README.md) separately documents its November 1 test, including a second reset retaining the updated version. That prior result is not substituted for a second-reset observation on Sirui's board.

A Memfault startup certificate-provisioning error (`-17`) remains in the logs. It did not prevent the observed firmware download, cloud reconnection, or subsequent diagnostic upload, but its cause remains unresolved. No UART serial-recovery extra credit is claimed. Sensor readings remain simulated.

**AI assistance disclosure:** AI assistance was used to inspect source/configuration, add the local MAC-address log, assist with credential provisioning, and organize this report. Local results above are based on build/tool outputs and the actual serial logs collected during this session; prior team results are explicitly identified as repository records.

## Q3. Wireless Demo (in person)

## Q4. Submission Requirements
