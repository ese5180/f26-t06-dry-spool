# DrySpool web Dashboard

The Dashboard reads each box's temperature, humidity, filament remaining, fan
and firmware state from nRF Cloud. Sign in with the same account as the
[DrySpool Setup app](../setup-app/README.md). **Monitor** shows readings,
**Devices** manages boxes, and **Settings** contains account controls. The
server checks ownership for readings, settings and fan commands.

## Configure a development or staging instance

1. Prepare a Supabase project with email/password authentication. Apply
   [the ownership migration](db/001_device_ownership.sql) using the project's
   SQL editor or migrations process. Enable email confirmation. Allow
   `<dashboard-origin>/auth/callback` as an Auth redirect URL and configure
   email delivery for the intended test accounts.
2. Copy `.env.example` to `.env.local` for local testing. Configure staging
   variables in Vercel if the team uses a staging project.

| Variable | Value |
| --- | --- |
| `NRF_ORG`, `NRF_PROJECT` | Organization and project slugs for the registered DrySpool boxes |
| `DRYSPOOL_OAT` | Server-only nRF Cloud Organization Auth Token with device shadow read/write permissions |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Supabase project URL and its publishable authentication key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for ownership queries and claim functions |
| `DRYSPOOL_WEB_ORIGIN` | Dashboard origin for email confirmation links, e.g. `https://your-staging-dashboard.example` |
| `NEXT_PUBLIC_DRYSPOOL_SETUP_URL` | Optional mobile setup link. The default opens `dryspool://setup` |
| `NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL`, `NEXT_PUBLIC_NRF_CLOUD_METRICS_URL` | Optional links to existing team cloud tools |

Use Node 24 and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. Use a reachable HTTPS staging origin for the
phone app. The older shared demonstration site does not contain this account
and ownership flow until the updated branch and database migration are deployed.

## Add and verify a box

1. A team member prepares a box using the
   [nRF Cloud onboarding guide](../docs/TEAM_SETUP_AND_DEMO.md#4-add-a-new-dk-to-nrf-cloud).
   Install the [BLE setup firmware](../firmware/README.md#bluetooth-setup).
2. In the Dashboard, create a test account and confirm its email. Sign into the
   same account on the phone and follow the [app setup steps](../setup-app/README.md#first-box).
3. In **Monitor**, compare the temperature and humidity with the serial output
   and the device shadow. The scale reading stays unavailable until calibrated.
   Test the fan controls only with hardware present. Wait for confirmation
   from that box, and verify other boxes stay unchanged.
4. Power off a box and wait about 45 seconds. Its controls should become
   unavailable and its readings should be marked as last recorded. Name and
   Wi-Fi settings are in the selected box's settings.
5. Check a second account. It starts with no boxes and cannot read or operate
   the first account's device through the API.

Device IDs from BLE locate the candidate. A claim completes only when the
matching short-lived proof appears in the authenticated shadow of the expected
serial. Existing fleet records are not assigned to an account automatically.
Each test box can go through app onboarding after it has the BLE firmware.

See [NFC integration notes](../docs/NFC_INTEGRATION.md) for the optional spool
identity and [firmware verification](../firmware/README.md#verify-a-signed-firmware-update)
for signed updates.
