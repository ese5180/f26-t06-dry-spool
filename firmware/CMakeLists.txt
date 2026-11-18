cmake_minimum_required(VERSION 3.20.0)
# This must be set before Zephyr adds the Nordic nanopb library.
if("${CMAKE_CURRENT_SOURCE_DIR}/config/ble_setup.conf" IN_LIST CONF_FILE)
  set(NANOPB_OPTIONS "--options-file=${CMAKE_CURRENT_SOURCE_DIR}/config/ble_personal_wifi.options")
endif()
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(dryspool)

target_include_directories(app PRIVATE src)
target_sources(app PRIVATE
  src/main.c
  src/sensors/bme280.c
  src/sensors/nau7802.c
  src/control/fan.c
  src/spool/profile.c
  src/spool/calibration.c
  src/shell/commands.c
  src/readings.c
)

if(CONFIG_DRYSPOOL_CLOUD)
  include(cmake/memfault.cmake)
  target_sources(app PRIVATE src/cloud/cloud.c src/cloud/telemetry.c src/cloud/box_shadow.c)
  if(CONFIG_DRYSPOOL_BLE_SETUP)
    target_sources(app PRIVATE src/setup/provisioning.c)
    zephyr_library_include_directories($<TARGET_PROPERTY:wifi_prov_core,BINARY_DIR>)
    target_link_libraries(app PRIVATE wifi_prov_ble)
  endif()
  target_sources_ifdef(CONFIG_SAMPLE_MEMFAULT_FOTA app PRIVATE src/ota/trial_image.c)
  if("${CONFIG_MEMFAULT_NCS_PROJECT_KEY}" STREQUAL "")
    message(WARNING "No Memfault project key configured. For release checks, build with -DEXTRA_CONF_FILE=<absolute path to firmware/local.conf>.")
  endif()
endif()
