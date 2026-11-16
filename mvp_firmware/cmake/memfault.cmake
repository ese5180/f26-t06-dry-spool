set(dryspool_src "${CMAKE_CURRENT_LIST_DIR}/../src")
target_include_directories(app PRIVATE "${dryspool_src}")
zephyr_include_directories("${dryspool_src}/diagnostics")
target_link_libraries(app INTERFACE "-Wl,--require-defined=g_memfault_build_id")
if(CONFIG_SAMPLE_MEMFAULT_FOTA OR CONFIG_DRYSPOOL_CLOUD)
  target_sources(app PRIVATE "${dryspool_src}/ota/memfault_update.c"
                             "${dryspool_src}/ota/update_reboot.c")
endif()
target_sources_ifdef(CONFIG_SAMPLE_MEMFAULT_BUTTONS app PRIVATE
                     "${dryspool_src}/diagnostics/memfault_buttons.c")
