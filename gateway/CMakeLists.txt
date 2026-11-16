cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(dryspool_ble)
set(mvp "${CMAKE_CURRENT_SOURCE_DIR}/../mvp_firmware/src")
target_include_directories(app PRIVATE "${mvp}")
target_sources(app PRIVATE src/radio.c)
if(CONFIG_DRYSPOOL_NODE)
  zephyr_include_directories("../firmware/config")
  target_link_libraries(app INTERFACE "-Wl,--require-defined=g_memfault_build_id")
  target_sources(app PRIVATE src/node_fleet.c src/node.c "${mvp}/main.c" "${mvp}/bme280.c" "${mvp}/fan.c"
    "${mvp}/nau7802.c" "${mvp}/calibration.c" "${mvp}/profile.c" "${mvp}/readings.c" "${mvp}/commands.c")
else()
  # The nRF70 driver consumes the original radio patch header. It is a
  # fixed factory component on SPI NOR, outside the signed app's DFU slots.
  dt_nodelabel(patch_node NODELABEL nrf70_wifi_fw_partition REQUIRED)
  dt_nodelabel(qspi_node NODELABEL qspi REQUIRED)
  dt_reg_addr(patch_offset PATH "${patch_node}")
  dt_reg_addr(ext_flash_base PATH "${qspi_node}" NAME qspi_mm)
  math(EXPR patch_address "${ext_flash_base} + ${patch_offset}")
  set(patch_bin "${ZEPHYR_NRFXLIB_MODULE_DIR}/nrf_wifi/bin/ncs/default/nrf70.bin")
  add_custom_command(OUTPUT "${CMAKE_BINARY_DIR}/nrf70.hex"
    COMMAND ${Python3_EXECUTABLE} -c
      "import sys,intelhex; sys.exit(intelhex.bin2hex(sys.argv[1], sys.argv[2], int(sys.argv[3])))"
      "${patch_bin}" "${CMAKE_BINARY_DIR}/nrf70.hex" "${patch_address}"
    DEPENDS "${patch_bin}" VERBATIM)
  add_custom_target(gateway_wifi_patch ALL DEPENDS "${CMAKE_BINARY_DIR}/nrf70.hex")
  target_sources(app PRIVATE src/gateway.c src/web.c src/cloud_shadow.c src/box_relay.c)
  zephyr_include_directories(config)
  target_link_libraries(app INTERFACE "-Wl,--require-defined=g_memfault_build_id")
  zephyr_linker_sources(SECTIONS sections.ld)
  zephyr_linker_section(NAME http_resource_desc_gateway_http KVMA RAM_REGION GROUP RODATA_REGION)
  generate_inc_file_for_target(app "${CMAKE_CURRENT_SOURCE_DIR}/web/index.html"
    "${ZEPHYR_BINARY_DIR}/include/generated/dryspool_page.inc" --gzip)
endif()
