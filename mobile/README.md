# DrySpool mobile dashboard

Open the [DrySpool dashboard](https://dryspool-dashboard.vercel.app) on a phone or computer. DrySpool boxes connect to nRF Cloud over Wi-Fi with their own device certificates. The dashboard reads temperature, relative humidity, remaining filament, fan state and firmware status from each device shadow. It lists the discovered boxes and shows one selected box at a time; there is no fixed four-box limit. Anyone with the dashboard URL can currently view the shared project readings and control the fan on an online box. This prototype does not have account ownership yet. Register each board's Wi-Fi MAC address if the campus network requires it.

## Add a box

Flash the Wi-Fi box firmware, register the device with its own credentials in the same nRF Cloud project and connect it to Wi-Fi. Leave the dashboard open. It lists project devices automatically and adds a card when it recognizes the box software type (`dryspool-wifi-box` or legacy `dryspool-app`) or the box reports its DrySpool fan protocol in the device shadow. The server refreshes the inventory about every 30 seconds and the open dashboard polls readings every five seconds. Adding a box requires no dashboard configuration or redeployment.

The device list shows the nRF Cloud nickname if set, or the device serial. Optional A/B/C aliases label only recognized boxes; unused aliases no longer create empty devices. Select a box to see its detail. Fan commands always target the serial, even when nicknames match or change. A box needs a fresh, valid fan reading to enable its controls. Older readings are labeled as last recorded, and fan output becomes unknown when offline. [nRF Cloud device inventory](https://docs.nrfcloud.com/api/list-devices)

## Run and deploy

Use Node 24 and the pnpm version specified in `package.json`. Copy `.env.example` to `.env.local` for local testing. For deployment, configure these variables in the Vercel project settings.

| Variable | Value |
| --- | --- |
| `NRF_ORG`, `NRF_PROJECT` | Organization and project slugs from the team's nRF Cloud project URL |
| `NRF_DEVICE_A`, `NRF_DEVICE_B`, `NRF_DEVICE_C` | Optional aliases for existing boxes. A configured ID keeps its Box A, B or C label. Leave unused aliases empty. |
| `DRYSPOOL_OAT` | Server-side nRF Cloud Organization Auth Token for the project, with permission to list project devices and read and update device shadows |
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

1. Connect a box over USB. Follow the [firmware guide](../firmware/README.md) to flash it, configure Wi-Fi and install its device certificate. Check the startup log for `Device Wi-Fi MAC` and `nRF Cloud device ID`, then match the ID to the box in the device list. Add more boxes in the same cloud project to test switching.
2. Compare temperature and relative humidity in its `reported.dryspool` shadow with the selected box and serial output. Remaining filament displays a dash until calibration is complete. Tare the scale, calibrate it with a known mass, enter the empty spool mass and verify the reading in grams.
3. Select **On**, **Off** and **Auto** on a box with fan hardware. After each command, wait for **Box confirmed**, watch the physical fan and check other boxes remain unchanged. Only the selected device receives `desired.config.fan`. The displayed fan output reflects the GPIO signal; check rotation on the box.
4. Disconnect one box and wait about 45 seconds. Its fan controls should become unavailable and its readings should be marked as last recorded. Other online boxes remain responsive.
5. Open **Metrics history** to view uploaded data or **Firmware releases** to open the team's OTA releases. To demonstrate an update on a single box, deploy to a cohort containing only that device and compare firmware versions afterward. [Signing and OTA instructions](../firmware/README.md#verify-a-signed-firmware-update)

## Future NFC spool identification

See the [NFC integration notes](../docs/NFC_INTEGRATION.md) for where an
optional spool identity would enter the dashboard data model. The filament
section currently says no tag data until a fresh, validated spool identity
exists. It does not simulate a scan or write. See the [mobile product plan](../docs/MOBILE_PRODUCT_PLAN.md)
for OpenPrintTag feasibility, account and setup design, storage humidity
references, and possible slicer export.
