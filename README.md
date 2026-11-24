# ESE5180: IoT Venture

**Team Number: T06**

**Team Name: DrySpool**

| Team Member Name | Email Address                |
| ---------------- | ---------------------------- |
| Sirui Wu         | wu40@engineering.upenn.edu   |
| Zicong Zhang     | zhang89@seas.upenn.edu       |
| Deepa Lokesha     | deepasr1@engineering.upenn.edu  |

**GitHub Repository URL:** https://github.com/ese5180/f26-t06-dry-spool

## Project layout

| Location | What to find there |
| --- | --- |
| [firmware/](firmware/README.md) | Zephyr application for the nRF7002 DK, with offline and connected build profiles |
| [mobile/](mobile/README.md) | Account backend, device ownership, and web Dashboard |
| [docs/](docs/TEAM_SETUP_AND_DEMO.md) | Team setup, provisioning, release, and demo guide |
| [docs/history/](docs/history/COURSE_EVIDENCE.md) | Course evidence for wireless updates and fleet management, including the [original demo report](docs/history/IoT%20Venture%20-%20Wireless%20Demo%20%26%20Secure%20Firmware%20Updates.pdf) |

The MVP reads a BME280 and two load cells through one NAU7802 (A/B channels)
for one spool, controls the circulation fan,
and saves the active spool, calibration, and thresholds locally. Connected
builds report to nRF Cloud and support signed updates through Memfault.


## Implemented functions

- BME280 temperature and humidity sensing.
- Two load cells on NAU7802 channels A/B, independently calibrated and summed for one spool.
- Local fan control, spool selection, calibration and persistent thresholds.
- Wi-Fi telemetry and fan commands through nRF Cloud.
- Signed firmware updates and diagnostics through Memfault.
- Account-scoped web dashboard, device names and manually entered filament profiles.

See [firmware setup](firmware/README.md) for wiring, calibration and Wi-Fi configuration,
and [dashboard setup](mobile/README.md) for accounts and device assignment.
