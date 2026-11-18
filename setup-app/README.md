# DrySpool Setup for iOS and Android

Use this app to add a box or change its Wi-Fi. Use the web Dashboard to monitor
and control boxes. Both use the same DrySpool account.

## Team setup

1. Configure the [web backend](../mobile/README.md), then create and confirm a
   test account on the Dashboard.
2. Copy `.env.example` to `.env.local`. Use the same Supabase project as the
   web backend. Set `EXPO_PUBLIC_DASHBOARD_URL` to the HTTPS staging Dashboard
   the phone can reach. Use the publishable key. The server key stays on the web backend.
3. Build and flash the [BLE firmware profile](../firmware/README.md#bluetooth-setup)
   on an nRF7002 DK with its own nRF Cloud credentials.
4. Install the app using a native development build:

   ```sh
   pnpm install --frozen-lockfile
   pnpm test
   pnpm android  # Android SDK, JDK and a physical Android device
   pnpm ios      # macOS, Xcode and signing for a physical iPhone
   ```

Expo Go cannot load this project's BLE module. `pnpm exec expo export --platform all`
checks both JavaScript bundles. BLE still needs a signed native build and a handset.
The `dryspool://setup` link opens the installed app.

## First box

1. Sign in. Tap **Add device**. If the box is missing, press Setup (the DK's
   second user button, `sw1`) once and scan again.
2. Select the nearby box. When the app says **Confirm on the box**, press Setup
   on that box. Accept the phone's Bluetooth prompt if it appears.
3. Pick the home Wi-Fi and enter its password. Use a personal Wi-Fi network
   without a sign-in portal for the first test.
4. Keep the box on until the app says **Box added**. Open the Dashboard with
   the same account. The box can show **Waiting for first reading** until its
   sensors report. A Wi-Fi error keeps the user on the network step for a retry.
5. To change Wi-Fi, choose **Change Wi-Fi** for that box in the app, press Setup
   to enable discovery, and follow the same steps. Onboarding does not release
   an existing account's ownership.

## What travels on each connection

The app uses the Nordic NCS 3.4.0 Wi-Fi provisioning messages over encrypted
BLE and the DrySpool GATT service for the device ID, physical Setup confirmation
and an opaque claim credential. The password stays between the phone and the
box. The box reports only a SHA-256 proof through its certificate-authenticated
nRF Cloud shadow. The backend compares that proof with the account's attempt
for that exact device and records ownership in PostgreSQL. The app receives the
result while the existing Dashboard reads data for the same owner.

BLE Secure Connections with a physical confirmation and no passkey encrypts
traffic, but its Just Works association does not authenticate a nearby peer
against an active relay. Keep provisioning windows short. Do not represent
this profile as proof of proximity against an adversarial radio environment.
