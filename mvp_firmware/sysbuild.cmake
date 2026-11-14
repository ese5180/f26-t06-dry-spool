# Keep the deployed MCUboot/TF-M settings and partition map. Use the same
# CoAP/HTTPS configuration fragments as the original connected application.
set(legacy_dir "${CMAKE_CURRENT_LIST_DIR}/../firmware")
set(mcuboot_APPLICATION_CONFIG_DIR "${legacy_dir}/sysbuild/mcuboot"
    CACHE PATH "DrySpool MCUboot configuration")
set(${DEFAULT_IMAGE}_CONF_FILE
    "${legacy_dir}/prj.conf;${legacy_dir}/boards/nrf7002dk_nrf5340_cpuapp_ns.conf;${legacy_dir}/coap.conf;${legacy_dir}/coap-fota.conf;${CMAKE_CURRENT_LIST_DIR}/prj.conf;${CMAKE_CURRENT_LIST_DIR}/cloud.conf"
    CACHE STRING "MVP application configuration fragments")
