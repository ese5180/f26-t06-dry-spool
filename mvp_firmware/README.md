# DrySpool 实物 MVP

nRF7002 DK 在本地读取 BME280 和 NAU7802，计算耗材余量并控制循环风扇。Wi-Fi 在线时，设备通过 CoAP/DTLS 向 nRF Cloud 上报实测数据，通过 Memfault Release Management 获取 HTTPS 固件更新。串口称重、校准和风扇控制在离线时继续工作。

## 接线（断电操作）

默认 DK 的 GPIO 是 **1.8 V**。推荐两块传感器小板由稳压 3.3 V 供电，和 DK 共地；SDA/SCL 经过支持开漏 I²C 的双向电平转换器，低压侧参考 DK 的 1.8 V，高压侧 3.3 V。勿把小板上拉至 3.3 V 的总线直接接到默认 DK。参见 [Nordic 硬件手册](https://docs.nordicsemi.com/r/bundle/ug_nrf7002_dk/page/ug/nrf7002_dk/intro.html)。

| DK 接口 | 外部连接 |
| --- | --- |
| D14 / P1.02 (SDA)、D15 / P1.03 (SCL) | 通过转换器并联 NAU7802（0x2A）和 BME280（默认配置 0x76）。若 BME280 为 0x77，把 overlay 中的节点名和 reg 都改为 77 / 0x77，再构建。 |
| A0 / P0.04（数字输出） | 风扇驱动器 IN，高有效；选择能识别 1.8 V 的输入或加电平转换，输入下拉以保证复位时关闭。5 V 风扇用独立供电和匹配的电机驱动器，与 DK 共地，勿从 GPIO 给电机供电。 |

[四线 5 kg 称重梁 #4541](https://www.adafruit.com/product/4541) 接 [NAU7802 #4538](https://www.adafruit.com/product/4538) 的激励端 E+/E− 与信号端 A+/A−。以传感器随附线序为准，新版小板的 B 通道不用；参见 [小板端子图](https://learn.adafruit.com/adafruit-nau7802-24-bit-adc-stemma-qt-qwiic/pinouts)。固定梁的一端，另一端承载整个卷盘支架，避免箱壁或线缆分担重量。总机械载荷（含支架）不得超过 5 kg。

## 构建、烧录与串口

在 nRF Connect SDK v3.4.0 工具链终端执行。以下命令从 DrySpool 仓库根目录开始。云端版本使用原项目的 Memfault Project Key 配置 `firmware/local.conf` 和 MCUboot 签名私钥 `firmware/keys/dryspool-signing.pem`。请将这两个本地文件保留在 Git 忽略路径。新电脑可向原项目维护者获取对应材料。[团队配置说明](../docs/TEAM_SETUP_AND_DEMO.md#1-shared-project-configuration)

```sh
west build -p always --sysbuild -b nrf7002dk/nrf5340/cpuapp/ns \
  -d build-mvp-cloud mvp_firmware -- \
  "-DEXTRA_CONF_FILE=$PWD/firmware/local.conf"
nrfutil device list
west flash -d build-mvp-cloud --dev-id JLINK_SERIAL
```

将 `JLINK_SERIAL` 替换为目标板的探针序列号。首次从原来的单镜像台架固件切换时，使用上述有线烧录安装 MCUboot 和应用，再检查校准数据和盘号。需单独调试传感器时，可以继续构建原来的台架配置：

```sh
west build --no-sysbuild -p always -b nrf7002dk/nrf5340/cpuapp -d build-mvp-local mvp_firmware
```

用 115200 8N1 打开应用核的 USB 虚拟串口。每轮采样后等待 2 秒，串口持续显示实测数据。温湿度采用千分单位，例如 `rh_mPct=40500` 表示 40.5% RH。

## 第一次称重

1. 保留安装好的支架，取下卷盘以及砝码，等读数稳定，输入 `dryspool tare` 记录零点。重新去皮后必须重新标定。
2. 只放上已知砝码，例如 500 g，稳定后输入 `dryspool cal 500`。参数是实际放上的克数。固件每次丢弃一个旧转换，再平均五个新读数。
3. 取下砝码。用空盘的实测重量选盘，例如 `dryspool spool PLA01 210`；放上对应卷盘。remaining_g 为测得总重扣除支架和 210 g 空盘后的净耗材量。换盘时重新输入盘号与空盘重；只保存当前盘。
4. 可用 `dryspool limits 30 40 100` 设置关风扇湿度、开风扇湿度（% RH）和低余量线（g）。示例也是默认值，仅作为台架起点。湿度在两条线之间保持原有风扇指令。测不到湿度时请求关闭；fan_command 只代表输出指令，无转速反馈。
5. 成功命令会显示 Saved.，参数保存在板载 flash 中。未标定或未设置空盘重时只报告原始计数，不显示克数；传感器读失败时显示 unavailable，不沿用旧值。

## 上板验收

- 用与标定砝码不同的已知重量检查净重；记录静止、卷盘转动和打印机拉丝时的误差，再决定低余量告警应预留多少克。
- 将湿度阈值设在当前读数两侧，分别跨过开、关阈值，核对串口、驱动器输入及风扇实物。再把阈值恢复到所需值。
- 无网络冷启动，确认当前盘号、标定和阈值仍生效。分别在断电时拔掉一个传感器再重启，确认另一项功能仍可用；修复 BME280 接线后重启，以便 Zephyr 重新初始化设备。

## 联网与设备凭据

每块 DK 使用自己的设备 ID 和 TLS 凭据。在已经入网的 DK 上先检查现有连接。新板按团队指南第 4 节，通过应用 UART 的 `tls_cred_shell` 安装本板证书，并将该设备注册到团队的 nRF Cloud 项目。证书、设备私钥、Wi-Fi 密码和发布令牌仅保存在本地受限位置。[团队入网步骤](../docs/TEAM_SETUP_AND_DEMO.md#4-add-a-new-dk-to-nrf-cloud)

在应用串口保存 WPA2-Personal 网络并发起连接：

```text
wifi cred add -s YOUR_SSID -k 1 -p YOUR_PASSWORD
wifi cred auto_connect
```

成功连接后即开始上报，之后默认间隔 60 秒。可在 nRF Cloud 的设备消息里查看下列数值。固件只发送当前有效的通道。NAU7802 未完成标定时也能查看 ADC 计数。离线期间 RAM 只保留最近一次采样，恢复连接后发送新鲜读数，不回放断网期间的历史记录。

| 消息 appId | 值 |
| --- | --- |
| `DRYSPOOL_TEMPERATURE_C` | BME280 温度，°C |
| `DRYSPOOL_HUMIDITY_PCT` | 箱内相对湿度，% RH |
| `DRYSPOOL_LOAD_CELL_COUNTS` | NAU7802 有符号 ADC 计数，取五次采样平均 |
| `DRYSPOOL_FILAMENT_G` | 已标定、扣除空盘重量后的净耗材量，g |
| `DRYSPOOL_DEHUMIDIFIER_ON` | 风扇 GPIO 指令，1 开、0 关 |

## 联网和断网验收

在有 C 编译器的电脑上可先检查遥测单位换算、无效通道屏蔽、零克读数和过期数据丢弃。以下命令从仓库根目录运行；这项测试不连接云端。

```sh
cc -std=c11 -I mvp_firmware/src mvp_firmware/tests/telemetry_test.c -o /tmp/dryspool-telemetry-test
/tmp/dryspool-telemetry-test
```

硬件和网络行为请在同一块测试板上检查：

1. 完成标定并选定空盘重。联网后，在 nRF Cloud 的对应设备记录中核对消息时间与数值。增加一个已知重量，保持到下一轮遥测，确认云端和串口的克数变化一致。
2. 运行中关闭接入点。加减砝码并通过串口调整湿度阈值，让当前湿度先高于开启阈值，再低于关闭阈值。即使无网络，串口仍应显示新的称重和风扇指令，风扇实物应随指令变化。
3. 保持接入点关闭，重启 DK。重复称重与风扇检查，验证设备也能离线冷启动。恢复接入点，观察新遥测恢复，并与当时串口数据对照。最后恢复原来的控制阈值。

## 签名升级验收

1. 在测试板烧录版本 N，用 `mflt get_device_info` 记录软件版本、软件类型、硬件版本和设备 ID，同时记录盘号、标定和一组串口读数。
2. 将 `mvp_firmware/VERSION` 中的镜像版本和 `mvp_firmware/cloud.conf` 中的 `CONFIG_APP_VERSION` 一起提升至 N+1，使用同一把团队签名密钥和相同的云端构建命令。以下为仓库根目录下的签名校验命令：

   ```sh
   python "$ZEPHYR_BASE/../bootloader/mcuboot/scripts/imgtool.py" verify \
     -k firmware/keys/dryspool-signing.pem \
     build-mvp-cloud/mvp_firmware/zephyr/zephyr.signed.bin
   ```

3. 在目标项目上传 `build-mvp-cloud/mvp_firmware/zephyr/zephyr.signed.bin` 作为升级包，上传同目录 `zephyr.elf` 作为调试符号。按测试板报告的软硬件标识创建 N+1 release，先部署到测试板所在的测试 cohort。[发布命令](../docs/TEAM_SETUP_AND_DEMO.md#6-publish-a-new-fota-release)
4. 设备会定期检查新版本。现场也可通过 UART 用 `mflt get_latest_url` 检查更新，再用 `mflt get_latest_release` 下载。观察 HTTPS 下载、重启、MCUboot 验签和新应用启动，记录镜像确认日志。试运行期间，设置加载正常、BME280 温湿度与 NAU7802 原始读数有效、风扇 GPIO 指令成功后，应用才会确认镜像。确认可以在断网或秤尚未标定时完成。试运行镜像未确认时，下次复位将触发 MCUboot 回滚。
5. 运行 `mflt get_device_info` 核对 N+1。再次重启并核对版本、标定和云端实测读数，确认更新已保留。
