# DrySpool 网关、箱子与云端固件更新

A、B 在箱内采集温湿度、称量耗材并驱动风扇。两台箱子通过 BLE 连接 G。G 只用一个校园 Wi-Fi MAC，通过 CoAP/DTLS 同步 nRF Cloud 的 Device Shadow，通过 HTTPS 转发 Memfault 数据和固件。手机可以在蜂窝网上使用 [DrySpool PWA](../mobile/README.md)。

## 首次刷机

在 nRF Connect SDK 3.4.0 终端，从仓库根目录操作。先按[团队设置指南](../docs/TEAM_SETUP_AND_DEMO.md) 准备签名密钥和含 Memfault Project Key 的 `firmware/local.conf`，用 `nrfutil device list` 对照三块板的调试器序列号。脚本按角色生成独立的构建目录。

```sh
./gateway/build.sh A
./gateway/build.sh B
./gateway/build.sh G
west flash --no-rebuild -d build-gateway-pwa-A --dev-id SERIAL_A
west flash --no-rebuild -d build-gateway-pwa-B --dev-id SERIAL_B
./gateway/flash-g.sh "$PWD/build-gateway-pwa-G" SERIAL_G
```

G 首次迁移到此配置时用 USB。脚本将与当前 NCS 配套的 Wi-Fi 补丁写到外部 Flash 的专用区域，并烧录 G 的启动程序、应用处理器和网络处理器。后续针对同一布局和 Wi-Fi 补丁的应用更新可以走云端 OTA。

## 配网、配对与看板

1. 打开 G 的应用 UART（115200），登记启动日志中的 `Register gateway Wi-Fi MAC`。按[设备注册流程第 4 节](../docs/TEAM_SETUP_AND_DEMO.md#4-add-a-new-dk-to-nrf-cloud) 为 G 安装它自己的 CoAP 设备证书并注册其设备 ID。PWA 服务端的 `NRF_GATEWAY_ID` 填这个 ID。现场网络要允许 G 访问 NTP、CoAP/DTLS 和 HTTPS。
2. WPA2-PSK 示例：在 G 串口运行 `wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD`，然后运行 `wifi cred auto_connect`。A、B 使用 BLE，各自的 Memfault 身份来自本板硬件 ID。
3. 首次配对，同时按住 G 和 A 的 **Button 1**，直到收到 A 的读数。对 B 重复。按[称重步骤](../mvp_firmware/README.md) 给两台箱子分别去皮、校准、设置空盘重量。有效校准完成前余量显示为 **—**。
4. 手机打开部署后实际分配的 HTTPS 地址。A、B 的最新样本位于 G 的 `reported.dryspool.A/B`。用户选择风扇模式后，服务端把模式、请求编号和期限放入 `desired.config.A/B`。G 等到对应箱子回报已应用指令后，才把相同请求写入 `reported.config`。G 时间未同步或命令过期时不会重新执行旧操作。
5. 现场验收时，开关 A，观察 A 的实体风扇和手机上的执行确认，再检查 B 的模式；对 B 重复并恢复自动。G 串口另外显示局域网网页和连接码，可在允许客户端互访的网络上调试。云端 PWA 不需要手机与 G 同网。

## 在 nRF Cloud 发布 FOTA

首次把上述新固件刷到三块板并完成配网。G 为每个箱子转发 Memfault 心跳，并带着该箱子的硬件序列号、硬件类型、软件类型和当前版本定期查询 release。云端设备记录与 G 的控制 Shadow 各有用途。前者用于单设备固件和诊断，后者用于 A、B 的实时操作。

| 对象 | Software type | Hardware version | 首刷构建目录 |
| --- | --- | --- | --- |
| A | `dryspool-box-a` | `dryspool-box-a` | `build-gateway-pwa-A` |
| B | `dryspool-box-b` | `dryspool-box-b` | `build-gateway-pwa-B` |
| G | `dryspool-gateway` | `nrf7002dk-rev1` | `build-gateway-pwa-G` |

1. 记录现场基线的实际版本。在团队项目 **Fleet → Devices** 确认 A、B、G 的设备 ID、软件类型及版本。若只想给 A 升级，将目标 A 放到相应演示 cohort。
2. 准备正式演示升级时，再将 `gateway/VERSION` 调到高于现场基线的版本，用相同签名密钥把对应角色重建到单独的输出目录。签名时给 A、B 各自写入受保护的角色标识。网关核对角色，MCUboot 核验签名。
3. 在团队 **Software → Symbol Files** 上传该次构建的 `gateway/zephyr/zephyr.elf`。在 **Software → OTA Releases** 为对应的软件与硬件类型创建 release，上传同一次构建的 `gateway/zephyr/zephyr.signed.bin`，检查版本和目标 cohort，再激活。
4. **更新箱子**时，G 代目标箱子查询、下载并通过 BLE 转发签名镜像，箱子重启并执行健康检查。回到手机页与云端设备记录核对实际运行版本，再检查读数、风扇和另外一台箱子。**更新 G** 时，G 自己通过 Wi-Fi 获取签名镜像；可在 G 的串口运行 `mflt get_latest_release` 立即检查。
5. 若需要演示手机直连 BLE，使用 nRF Connect Device Manager 的 Image → Test & Confirm，选目标箱子的 `dfu_application.zip`。手机首次配对按住对应箱子的 Button 1。[Nordic BLE FOTA 教程](https://academy.nordicsemi.com/courses/nrf-connect-sdk-intermediate/lessons/lesson-9-bootloaders-and-dfu-fota/topic/exercise-5-fota-over-bluetooth-low-energy/) · [网关代查下游发布](https://docs.nrfcloud.com/docs/best-practices/ota-components)

## 课程演示

在 G 串口用 `mflt get_device_info` 核对身份，用 `mflt test heartbeat` 和 `mflt post_chunks` 检查 G 的指标。对箱子也可触发心跳并等 G 转发，随后在 A、B 各自的设备记录查看温湿度、余量和风扇输出。演示 G 的 core dump 时，先上传当前 ELF，用 `mflt coredump_size` 对照存储容量，再用 `mflt test assert` 触发受控重启；通过 `mflt get_core`、`mflt post_chunks` 与云端 Issue 交叉验证。现场保存实际的升级前后版本和物理风扇动作作为证据。
