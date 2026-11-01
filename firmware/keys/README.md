# Firmware signing key

`dryspool-signing.pem` is the team's MCUboot ECDSA-P256 private key. It is
intentionally excluded by `.gitignore`; never commit it or send it through a
public channel.

Generate it once from an nRF Connect SDK terminal:

```powershell
python $env:ZEPHYR_BASE\..\bootloader\mcuboot\scripts\imgtool.py keygen `
  -k keys\dryspool-signing.pem -t ecdsa-p256
```

Every teammate who must produce an accepted image needs the same key at that
path. Back it up in the team's approved secret store. A board flashed with a
bootloader containing a different public key will reject the image.

For this course project, the team may distribute the file through a restricted
Google Drive folder. Grant access only to current firmware teammates, disable
public/link-wide access, and do not put the Drive URL in this public repository.
After downloading it, each teammate must place it at exactly
`firmware/keys/dryspool-signing.pem` and confirm that Git ignores it:

```powershell
git check-ignore firmware/keys/dryspool-signing.pem
```

This firmware-signing key is not the same as the nRF Cloud project key, an
Organization Auth Token, the project CA private key, or an individual device's
TLS private key. See `../../docs/TEAM_SETUP_AND_DEMO.md` for the separation and
handling of those credentials.

The key generated for the `wireless-update` branch has MCUboot SHA-256 key hash
`c2b949a288d26410f3af503c6973fd932b72546a3b011f308fc80729b70373e4`.
Teammates can compare the `KEYHASH` printed by `imgtool.py dumpinfo` without
exposing the private key.
