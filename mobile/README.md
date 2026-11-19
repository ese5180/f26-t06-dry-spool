# DrySpool web Dashboard

The Dashboard reads each box's temperature, humidity, filament remaining, fan
and firmware state from nRF Cloud. Sign in with the same account as the
[DrySpool Setup app](../setup-app/README.md). **Monitor** shows readings,
**Devices** manages boxes, and **Settings** contains account controls. The
server checks ownership for readings, settings and fan commands.

The Carbon interface uses a desktop sidebar and phone bottom navigation.
Monitor opens the first box. Use Choose box to switch devices or select All
boxes for the overview. Humidity, temperature, and filament remaining share
the same visual emphasis. Product artwork is illustrative. Readings and
controls continue to follow the selected device's reported state.

### Edit filament material and color

Select a real box in **Monitor**, then choose **Filament → Edit filament**.
Choose a material (or enter a custom material), enter its color name, optionally
pick a color swatch and brand, and choose **Save filament**. The profile is
saved per box, survives page reloads, and remains visible while the box is offline.
The virtual preview cannot save a profile. Saving does not change scale calibration,
fan thresholds, printer settings, or measured sensor values.

The authenticated `PUT /api/devices/:serial/filament` endpoint checks ownership
and validates the profile before merging only `desired.config.filament` in the
box's nRF Cloud shadow. No database migration is needed. Cloud write access is
required; a rejected save keeps the draft and shows an error. Stored profiles
contain `material`, `color`, optional `colorHex`/`brand`, server-set `source: manual`,
`version: 1`, and `updatedMs`. Manual profiles take precedence over reported
identity and are labeled accordingly. They describe the current spool assigned
to that box; update them when replacing a spool. They are not a spool inventory.

Storage guidance is shown for supported materials, with humidity warnings only
when a fresh reading is available. Custom materials do not receive guessed limits.
NFC tag reading/writing remains separate future work; saving here never writes a tag.

## Configure a development or staging instance

1. Prepare a Supabase project with email/password authentication. Apply
   [the ownership migration](db/001_device_ownership.sql) using the project's
   SQL editor or migrations process. Enable email confirmation. Allow
   `<dashboard-origin>/auth/callback` as an Auth redirect URL and configure
   email delivery for the intended test accounts.
   Also allow `<dashboard-origin>/auth/callback?next=/reset-password` for
   password recovery. Confirm sign-up and recovery emails return to the public
   HTTPS dashboard. The built-in sender restricts recipients, so configure
   custom SMTP before accepting registrations from customers. See
   [Supabase email delivery](https://supabase.com/docs/guides/auth/auth-smtp).
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
| `NEXT_PUBLIC_DRYSPOOL_IOS_SETUP_URL`, `NEXT_PUBLIC_DRYSPOOL_ANDROID_SETUP_URL` | HTTPS installation links for the signed Setup apps. Leave unset until a tested build is available. |
| `NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL`, `NEXT_PUBLIC_NRF_CLOUD_METRICS_URL` | Optional links to existing team cloud tools |

Use Node 24 and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. Use a reachable HTTPS staging origin for the
phone app. The Vercel demo uses this account and ownership flow. App installation
links are configured separately when signed phone builds are ready.

## Customer account and first setup

Customers register and sign in through DrySpool. The team maintains Supabase,
nRF Cloud, device certificates, and hosting. The customer does not create a
provider account or enter service keys.

The account screen supports email confirmation, resending confirmation, and
password recovery. Email links currently use PKCE, so open the link in the same
browser where the request started. An expired link returns to a retry screen.
Test actual inbox delivery and recovery before inviting external customers.

Add device and Change Wi-Fi open an installation and setup guide. With no
installation link configured, it states that the app is still in testing.
Users with an installed test build can choose the explicit Open Setup option.
Once setup completes, Check my boxes refreshes the account's devices. The guide
does not claim a device or generate readings on the customer's behalf.

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
