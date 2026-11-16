# Keep the application's nRF70 driver reading its factory-programmed raw
# patch from SPI NOR. The top-level DFU package contains the app only.
set_config_bool(${ZCMAKE_APPLICATION} CONFIG_NRF_WIFI_PATCHES_EXT_FLASH_DISABLED n)
set_config_bool(${ZCMAKE_APPLICATION} CONFIG_NRF_WIFI_PATCHES_EXT_FLASH_STORE y)
