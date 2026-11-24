# DrySpool dashboard

Open the dashboard to view temperature, humidity, filament weight, device status and last report time. Fan buttons select Auto, On or Off and wait for device confirmation. Stale or unavailable devices cannot be controlled.

This dashboard is public: anyone with the URL can view the configured boxes and control their fans. There is no password or account service. Device secrets remain server-only. Requests can target only the configured devices; fan changes require same-origin JSON.

## Configuration

Set these server environment variables in Vercel Production:

- `NRF_ORG`, `NRF_PROJECT`: nRF Cloud organization and project.
- `DRYSPOOL_OAT`: nRF Cloud token with device shadow read/write access.
- `NRF_DEVICE_A`, `NRF_DEVICE_B`, optional `NRF_DEVICE_C`: device serials.

Use Node 24 and the pnpm version in package.json. Run `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm build`. Deploy the mobile directory to the existing Vercel project.

Missing measurements show “No reading”; offline measurements are labeled as last recorded. Calibrate both load cells and set empty-spool mass through the firmware serial shell before expecting filament grams.
