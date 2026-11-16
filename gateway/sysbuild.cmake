set(mcuboot_APPLICATION_CONFIG_DIR "${CMAKE_CURRENT_LIST_DIR}/../firmware/sysbuild/mcuboot"
    CACHE PATH "Use the shared external update slot and MCUboot verification key")
if(SB_CONFIG_WIFI_NRF70)
  set_property(TARGET ${DEFAULT_IMAGE} APPEND PROPERTY IMAGE_CONF_SCRIPT
    "${CMAKE_CURRENT_LIST_DIR}/sysbuild/factory_wifi.cmake")
endif()
