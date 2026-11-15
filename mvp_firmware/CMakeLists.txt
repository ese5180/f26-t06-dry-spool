cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(dryspool_mvp)
target_sources(app PRIVATE
  src/main.c
  src/bme280.c
  src/nau7802.c
  src/fan.c
  src/profile.c
  src/calibration.c
  src/commands.c
  src/readings.c
)

if(CONFIG_DRYSPOOL_CLOUD)
  set(legacy_src "${CMAKE_CURRENT_SOURCE_DIR}/../firmware/src")
  target_sources(app PRIVATE src/cloud/cloud.c src/cloud/telemetry.c
                 "${legacy_src}/memfault_fota_support.c" "${legacy_src}/sample_reboot.c")
  target_sources_ifdef(CONFIG_SAMPLE_MEMFAULT_FOTA app PRIVATE src/trial_image.c)
  target_sources_ifdef(CONFIG_SAMPLE_MEMFAULT_BUTTONS app PRIVATE "${legacy_src}/memfault_buttons.c")
  if("${CONFIG_MEMFAULT_NCS_PROJECT_KEY}" STREQUAL "")
    message(WARNING "No Memfault project key configured. For release checks, build with -DEXTRA_CONF_FILE=<absolute path to firmware/local.conf>.")
  endif()
  target_include_directories(app PRIVATE src "${legacy_src}")
  zephyr_include_directories(../firmware/config)
endif()
