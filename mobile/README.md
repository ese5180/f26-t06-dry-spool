# DrySpool web Dashboard

The Dashboard reads each box's temperature, humidity, filament remaining, fan
and firmware state from nRF Cloud. Sign in with your DrySpool account. **Monitor** shows readings,
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
Saving does not change scale calibration,
fan thresholds, printer settings, or measured sensor values.

The authenticated `PUT /api/devices/:serial/filament` endpoint checks ownership
and validates the profile before merging only `desired.config.filament` in the
box's nRF Cloud shadow. No database migration is needed. Cloud write access is
required; a rejected save keeps the draft and shows an error. Stored profiles
contain `material`, `color`, optional `colorHex`/`brand`, server-set `source: manual`,
`version: 1`, and `updatedMs`. Profiles are entered manually. They describe the current spool assigned
to that box; update them when replacing a spool. They are not a spool inventory.

Storage guidance is shown for supported materials, with humidity warnings only
when a fresh reading is available. Custom materials do not receive guessed limits.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for ownership queries |
| `DRYSPOOL_WEB_ORIGIN` | Dashboard origin for email confirmation links, e.g. `https://your-staging-dashboard.example` |
| `NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL`, `NEXT_PUBLIC_NRF_CLOUD_METRICS_URL` | Optional links to existing team cloud tools |

Use Node 24 and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`.

## Customer account and first setup

Customers register and sign in through DrySpool. The team maintains Supabase,
nRF Cloud, device certificates, and hosting. The customer does not create a
provider account or enter service keys.

The account screen supports email confirmation, resending confirmation, and
password recovery. Email links currently use PKCE, so open the link in the same
browser where the request started. An expired link returns to a retry screen.
Test actual inbox delivery and recovery before inviting external customers.

## Assign and verify a box

1. Register the device in nRF Cloud using the [team guide](../docs/TEAM_SETUP_AND_DEMO.md#4-add-a-new-dk-to-nrf-cloud), then configure Wi-Fi through the [serial shell](../firmware/README.md#connect-to-wi-fi-and-nrf-cloud).
2. Create and confirm the dashboard account. In Supabase's SQL editor, insert its Auth user UUID and the registered device serial into `public.dryspool_devices` (`serial`, `owner_id`, `label`). Device assignment is an administrator operation; the application service role can only read and rename existing rows.
3. Sign in and compare temperature and humidity against the serial output. Calibrate both load cells and set empty-spool mass before checking filament weight.
4. Send a fan command and wait for confirmation from that box. Power it off; after 45 seconds the dashboard disables controls and marks readings as last recorded.
5. Verify a second account cannot read or operate the first account's box.

See [firmware verification](../firmware/README.md#verify-a-signed-firmware-update) for signed updates.
