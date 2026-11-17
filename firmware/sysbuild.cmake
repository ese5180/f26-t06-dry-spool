# Layer the connected profile before the shared application defaults.
set(app_dir "${CMAKE_CURRENT_LIST_DIR}")
set(connected_conf
    "${app_dir}/config/network.conf"
    "${app_dir}/boards/nrf7002dk_nrf5340_cpuapp_ns.conf"
    "${app_dir}/config/coap.conf"
    "${app_dir}/config/fota.conf"
    "${app_dir}/prj.conf")
set(${DEFAULT_IMAGE}_CONF_FILE "${connected_conf}"
    CACHE STRING "DrySpool connected application configuration")
