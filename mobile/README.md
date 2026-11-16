# DrySpool 手机看板

手机和电脑共用一个 Next.js PWA。A、B、C 是三台独立的 Wi-Fi 耗材箱。每台各用自己的设备证书连接 nRF Cloud，各有一个 Device Shadow。看板后端按设备 ID 读取温湿度、余量、风扇和固件状态，并把指令发给选中的箱子。使用校园网时登记三块板各自的 Wi-Fi MAC。

## 运行与部署

在本目录使用 Node 24 和项目指定的 pnpm。安装依赖后复制 `.env.example` 为 `.env.local`，填入下表的服务端环境变量。云端部署时，直接在 Vercel 项目设置里配置这些值。

| 变量 | 用途 |
| --- | --- |
| `NRF_ORG`、`NRF_PROJECT` | nRF Cloud 组织和项目 slug，可从团队项目地址读取 |
| `NRF_DEVICE_A`、`NRF_DEVICE_B`、`NRF_DEVICE_C` | 分别填写三台箱子启动时打印的 nRF Cloud device ID。可以先填一台，其他卡片会提示缺少 ID |
| `DRYSPOOL_OAT` | 项目范围的 nRF Cloud Organization Auth Token，Device Data → Manage（读写 shadow） |
| `DRYSPOOL_PASSWORD` | 演示成员的共享登录口令，可用 `openssl rand -hex 16` 本机生成 |
| `NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL` | 可选，手机页上的团队 OTA Releases 链接。它是公开 URL |
| `NEXT_PUBLIC_NRF_CLOUD_METRICS_URL` | 可选，团队 nRF Cloud 历史指标看板的公开 URL，访问页面需登录云端 |

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

本机测试时运行 `pnpm start --hostname 127.0.0.1`，打开 `http://127.0.0.1:3000`，输入 `DRYSPOOL_PASSWORD`。修改 `.env.local` 后重启服务。同一可信私人 Wi-Fi 下要用手机测试，可先停止本机服务，改用 `pnpm start --hostname 0.0.0.0`，在手机浏览器打开 `http://<Mac 的局域网 IP>:3000`。局域网 HTTP 适合测试网页操作；安装 PWA 和 Service Worker 使用受信任的 HTTPS 地址。

日后部署到 Vercel 时选择 Next.js 预设，只上传 `mobile` 目录，将上表变量设置在项目服务端。首次打开 HTTPS 网址后，在 iPhone Safari 的分享菜单选择「添加到主屏幕」，在 Android 的浏览器菜单选择安装。手机可以用蜂窝网访问部署后的站点。

## 实物验收

1. 先用 USB 连接箱 A，按[固件指南](../mvp_firmware/README.md)刷板、配置 Wi-Fi 和设备证书。查看串口的 `Device Wi-Fi MAC` 和 `nRF Cloud device ID`，核对 A 卡片对应的设备。B、C 可随后逐台加入。
2. 在 A 自己的 Device Shadow 查看 `reported.dryspool`，核对手机上的温度、湿度与串口。未称重校准时余量显示「—」。完成去皮、参考砝码和空盘设置后，放上已知重量核对克数。
3. 选择 A 的「开启」「关闭」「自动」，每次等「箱子已确认」，观察实体风扇和 B、C 的模式。每次只修改目标设备的 `desired.config.fan`，设备执行后回报相同请求。板端上报输出对应 GPIO，转动情况需现场观察。
4. 断开一台板的电源，等待约 45 秒，确认该卡片禁用控制，另外两台在线卡片继续操作。
5. 每台在项目中以自己的 ID 上报。用「历史指标」查看已上传的历史数据，用「固件发布」打开团队 OTA Releases。演示单台 OTA 时，选择只包含目标板的 cohort，实际升级后核对三张卡片的版本。[签名和 OTA 步骤](../mvp_firmware/README.md#verify-a-signed-firmware-update)
