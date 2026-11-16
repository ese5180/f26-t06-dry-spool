# DrySpool 手机看板

手机和电脑共用一个 Next.js PWA。手机通过 HTTPS 请求 Vercel，服务器读写 **G 的** nRF Cloud Device Shadow。G 通过校园 Wi-Fi 主动连云，通过 BLE 与 A、B 通信。手机用蜂窝网也能打开看板，只需为 G 注册 Wi-Fi MAC。

## 运行与部署

在本目录使用 Node 24 和项目指定的 pnpm。安装依赖后复制 `.env.example` 为 `.env.local`，填入下表的服务端环境变量。云端部署时，直接在 Vercel 项目设置里配置这些值。

| 变量 | 用途 |
| --- | --- |
| `NRF_ORG`、`NRF_PROJECT` | nRF Cloud 组织和项目 slug，可从团队项目地址读取 |
| `NRF_GATEWAY_ID` | G 的 CoAP Device Shadow ID，使用 G 入网生成的记录 |
| `DRYSPOOL_OAT` | 项目范围的 nRF Cloud Organization Auth Token，Device Data → Manage（读写 shadow） |
| `DRYSPOOL_PASSWORD` | 演示成员的共享登录口令，可用 `openssl rand -hex 16` 本机生成 |
| `NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL` | 可选，手机页上的团队 OTA Releases 链接。它是公开 URL |
| `NEXT_PUBLIC_NRF_CLOUD_METRICS_URL` | 可选，团队 nRF Cloud 历史指标看板的公开 URL，访问页面需登录云端 |

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start
```

本地打开 `http://localhost:3000`。生产环境使用 Vercel 的 Next.js 预设，项目根目录选 `mobile`。也可以在本目录用已登录的 Vercel CLI 执行 `vercel` 生成预览，配置 Production 环境变量后运行 `vercel --prod`。仅部署本目录。设备私钥和 MCUboot 签名私钥留在开发机。对课程演示可使用 Hobby 免费计划和 Vercel 提供的 HTTPS 域名。首次打开网址，输入共享口令。在 iPhone 的 Safari 分享菜单选择「添加到主屏幕」，Android 可在浏览器菜单选择安装。网站前台才会轮询，后台停止。

## 实物验收

1. 使用 [网关指南](../gateway/README.md) 配好三块板、称重校准以及 G 的 Wi-Fi 和云端身份。
2. 在 G 的 Device Shadow 中检查 `reported.dryspool.A` 和 `reported.dryspool.B` 的在线状态与读数。A、B 的最新样本按各自 `seq` 的云端元数据时间判定新鲜度。
3. 手机关掉 Wi-Fi，用蜂窝网进入看板，核对两箱读数和最近上报时间。拔掉 B 后，B 的控制会被禁用。
4. 点 A 的「开启」。Vercel 只修改 `desired.config.A`，G 收到后转给 A。比对网页回执、箱端日志和实体风扇，确认 B 的模式保持原值。再测试「关闭」和「自动」。接受请求的 HTTP 202 表示已写入云端，实际执行由箱子回执确认。命令有效期 45 秒。
5. 历史指标在 nRF Cloud 的 **Dashboards** 或设备 **Timeline** 中查看；发布固件进入 **Software → OTA Releases**。登录 PWA 与登录团队云后台分别使用各自的凭据。

## 费用

课程演示优先使用免费配额。Vercel Hobby 适用于个人非商业项目；nRF Cloud Developer 的设备名额按团队账户计算。查看 [Vercel Hobby 说明](https://vercel.com/docs/plans/hobby) 和 [nRF Cloud 定价](https://nrfcloud.nordicsemi.com/pricing/)。
