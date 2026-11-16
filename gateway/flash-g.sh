#!/usr/bin/env bash
# Factory programming includes the NCS Wi-Fi patch in external SPI NOR.
# Subsequent Memfault releases use only the signed application image.
set -euo pipefail
if [[ $# != 2 ]]; then
  echo "Usage: flash-g.sh <G-build-directory> <J-Link-serial>" >&2
  exit 2
fi
out=$(cd "$1" && pwd)
serial=$2
if [[ ! -s "$out/gateway/nrf70.hex" || ! -s "$out/gateway/zephyr/zephyr.signed.bin" ]]; then
  echo "Build the cloud gateway first with gateway/build.sh G <G-build-directory>." >&2
  exit 1
fi
west flash --no-rebuild -d "$out" --domain gateway --dev-id "$serial" --hex-file "$out/gateway/nrf70.hex"
west flash --no-rebuild -d "$out" --dev-id "$serial"
