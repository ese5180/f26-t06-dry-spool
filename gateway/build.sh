#!/usr/bin/env bash
set -euo pipefail
app=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$app")
role=${1:-}
out=${2:-"$repo/build-gateway-pwa-$role"}
extra=("-DEXTRA_CONF_FILE=")
case "$role" in
  A|B)
    board=nrf7002dk/nrf5340/cpuapp
    conf="$app/node.conf;$repo/firmware/local.conf"
    if [[ "$role" == B ]]; then conf="$conf;$app/node-b.conf"; fi
    ;;
  G)
    # gateway.conf selects the nRF70 driver and fixed SPI NOR microcode.
    # The SDK sysbuild Wi-Fi choice would add a second signed DFU image.
    extra+=("-Dipc_radio_EXTRA_CONF_FILE=$app/coex-radio.conf" "-DSB_CONFIG_WIFI_NRF70=y"
            "-DSB_CONFIG_WIFI_PATCHES_EXT_FLASH_STORE=n")
    board=nrf7002dk/nrf5340/cpuapp/ns
    conf="$app/gateway.conf;$repo/firmware/local.conf"
    ;;
  *) echo 'Usage: build.sh G|A|B [output-directory]' >&2; exit 1 ;;
esac
extra[0]="-DEXTRA_CONF_FILE=$conf"
west build --sysbuild -b "$board" -d "$out" "$app" -- "${extra[@]}"
