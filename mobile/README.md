# DrySpool mobile dashboard

Open the [DrySpool dashboard](https://dryspool-dashboard.vercel.app) on a phone or computer. Boxes A, B and C connect to nRF Cloud over Wi-Fi with their own device certificates. The dashboard reads temperature, relative humidity, remaining filament, fan state and firmware status from each device shadow. Anyone with the dashboard URL can view the readings and control the fan on an online box. Register each board's Wi-Fi MAC address if the campus network requires it.

## Run and deploy

Use Node 24 and the pnpm version specified in `package.json`. Copy `.env.example` to `.env.local` for local testing. For deployment, configure these variables in the Vercel project settings.

| Variable | Value |
| --- | --- |
| `NRF_ORG`, `NRF_PROJECT` | Organization and project slugs from the team's nRF Cloud project URL |
| `NRF_DEVICE_A`, `NRF_DEVICE_B`, `NRF_DEVICE_C` | The nRF Cloud device ID printed at startup by the corresponding box. You can start with one box. Each missing ID affects only its own card. |
| `DRYSPOOL_OAT` | Server-side nRF Cloud Organization Auth Token for the project, with Device Data → Manage permission to read and update shadows |
| `NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL` | Optional link to the team's OTA releases page, visible to dashboard users |
| `NEXT_PUBLIC_NRF_CLOUD_METRICS_URL` | Optional link to the team's metrics history. The cloud portal requires its own login. |

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. Restart the server after editing `.env.local`. To test on a phone over trusted private Wi-Fi, stop the server, run `pnpm start --hostname 0.0.0.0` and open `http://<Mac-LAN-IP>:3000` on the phone. Use the deployed HTTPS site for PWA installation and the service worker.

On Vercel, select the Next.js preset and deploy the `mobile` directory. Open the HTTPS URL in Safari on iPhone and choose **Share → Add to Home Screen**. On Android, choose **Install app** or **Add to Home screen** from the browser menu. The deployed dashboard also works over cellular data.

## Test with hardware

1. Connect Box A over USB. Follow the [firmware guide](../mvp_firmware/README.md) to flash it, configure Wi-Fi and install its device certificate. Check the startup log for `Device Wi-Fi MAC` and `nRF Cloud device ID`, then match the ID to Box A. Repeat for B and C when available.
2. Compare the temperature and relative humidity in A's `reported.dryspool` shadow with its dashboard card and serial output. Remaining filament displays a dash until calibration is complete. Tare the scale, calibrate it with a known mass, enter the empty spool mass and verify the reading in grams.
3. Select **On**, **Off** and **Auto** on Box A. After each command, wait for **Box confirmed**, watch the physical fan and check the modes on B and C. Only the selected device receives `desired.config.fan`. The displayed fan output reflects the GPIO signal. Check rotation on the box.
4. Disconnect one box and wait about 45 seconds. Its fan controls should become unavailable while the two online boxes remain responsive.
5. Open **Metrics history** to view uploaded data or **Firmware releases** to open the team's OTA releases. To demonstrate an update on a single box, deploy to a cohort containing only that device and compare the firmware versions on all three cards afterward. [Signing and OTA instructions](../mvp_firmware/README.md#verify-a-signed-firmware-update)
