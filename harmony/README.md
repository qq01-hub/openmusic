# OpenMusic HarmonyOS

独立的 ArkTS + ArkWeb 应用工程，复用现有网页与服务端，不依赖 Flutter，也不改变 Android APK 的构建流程

## 首版范围

- 加载配置站点，复用网页登录、公开房间列表、点歌、聊天、收藏和网页前台播放
- 收藏、登录和房间权限仍由现有服务端与 Redis 裁决，壳不保存业务状态、不接管 Socket
- 提供系统返回、加载进度、30 秒加载超时、主文档错误提示和返回首页重试
- 保留 ArkWeb 正常的 Cookie 与网页存储，不在启动、失败重试或升级时主动清理登录数据
- 接入独立的 HarmonyOS 媒体状态桥接，不模拟 `flutter_inappwebview`，也不改变 Android 桥接
- 接入 AVSession 系统音乐卡片与音频播放长时任务，切歌复用会话，播放时申请后台运行，暂停时释放后台任务但保留会话，离房或窗口销毁时清理
- 系统卡片显示歌曲、歌手和进度，封面暂用本地品牌图标，播放／暂停、下一首与进度操作仍受当前房间权限及系统媒体开关限制
- 本版未接入桌面悬浮歌词、原生分享和振动，进程被强制结束后的自动续播不在本版范围内
- 网页功能的复用不代表已通过鸿蒙真机验收，播放编码、OAuth 与设备行为必须按下方清单验证

## 开发前置条件

工程使用 Stage 模型，兼容版本保留 HarmonyOS 5.0.0 / API 12，目标版本更新为 HarmonyOS 5.1.0 / API 18，Hvigor modelVersion 为 5.0.0

需要提供 API 18 SDK 的 DevEco Studio 与相应 Hvigor 工具链，以及 API 12 或以上的鸿蒙设备或模拟器

API 15 及以上监听后台任务取消事件，API 18 及以上关闭 ArkWeb 自动生成的 AVSession，避免出现重复卡片，新 API 调用均有运行时版本判断，但 API 12／15／18 的设备兼容性仍需分别验收

当前仓库不附带 SDK、签名证书或预编译 HAP，也不通过 Flutter 打包此工程

## 配置站点

编辑 `entry/src/main/resources/base/element/string.json` 中的 `server_url`

```json
{
  "name": "server_url",
  "value": "https://music.example.com"
}
```

- 必须替换为实际部署的 HTTPS Origin，可以带端口，不能包含凭据、路径、查询参数或片段
- 默认值为空，应用仅显示配置提示，不会请求示例站点
- 本版不开放 HTTP 调试例外，局域网联调也要使用设备信任的 HTTPS 证书
- 这是应用打包时的站点入口，不是新的服务端环境变量
- 已支持在管理后台维护的业务配置仍在管理后台修改，不需要新建 `.env` 配置项
- 页面、音频和 Socket 必须满足现有 HTTPS/WSS 部署要求，不通过放宽混合内容或证书校验解决问题

## 打开、签名与构建

1. 用 DevEco Studio 打开本目录 `harmony`，不是仓库根目录，也不是 `mobile`
2. 安装上述 SDK 并同步工程，首次同步需要联网获取开发工具依赖
3. 按需设置 `AppScope/app.json5` 的 bundleName、版本号和应用名称，之后保持包名和签名一致以支持覆盖升级
4. 配置 `server_url`，连接鸿蒙设备或启动模拟器
5. 在 DevEco 的 Signing Configs 中配置本机调试签名，再运行 `entry`
6. 发布前使用发布证书和发布 profile 构建 release HAP，按发布渠道要求导出 App Pack

签名文件、口令和设备信息只保留在本地，DevEco 可能把签名配置写入受版本控制的 `build-profile.json5`，提交前必须检查并移除含本机路径、证书口令和 signingConfigs 的本地改动

`.gitignore` 已排除常见签名文件、`local.properties`、IDE 缓存、依赖与构建目录，但不能自动脱敏 JSON 中的口令

本工程没有提供伪造的 `hvigorw` 包装脚本，使用 DevEco 自带的工具链构建，不假设系统 PATH 中已有 Hvigor

## 本地预检

在仓库根目录执行，复用 `client` 已安装依赖中的 TypeScript 与 JSON5，不下载 SDK、不修改配置、不生成构建产物

```powershell
node 'harmony/scripts/check-project.mjs'
node 'harmony/scripts/check-project.mjs' --require-site
```

- 第一条检查 JSON5 配置、能力与页面入口、后台权限、目标 SDK、资源引用、站点规则及导航／媒体策略 TypeScript 类型，空站点会给出警告
- 第二条额外要求配置实际站点，`server_url` 为空或非法时退出码为 1，必须修正后才能继续发布
- 站点检查仅验证配置格式，不发起网络请求，不验证域名连通性、证书、登录或音频播放
- 原生工程仍须在 DevEco 中编译和验收，这两条命令都不会生成 HAP，也不会执行签名或设备测试
- 配置错误诊断不输出原始配置内容，避免泄漏站点凭据或本地签名口令

## 导航安全与登录

- 顶层页面只常规加载配置的 HTTPS 同源站点，来源比较包括协议、主机和有效端口
- 主框架用户手势触发的其他 HTTPS 链接交由系统浏览器处理，无手势的外站跳转被阻止
- 只从本站既有 GitHub / Linux.do 登录或后台登录、绑定起点开启五分钟 HTTPS OAuth 导航窗口
- OAuth 期间保留同一 ArkWeb Cookie 环境，回到本站回调或普通页面后关闭窗口，服务端仍验证 OAuth state 和会话
- OAuth 窗口期间允许外站 HTTPS 顶层导航，与 Android 壳的短时流程一致，不等同于只允许特定 OAuth 域名
- iframe 可以加载 HTTPS 页面或空白文档，但不能开启 OAuth 窗口或拉起系统应用
- 拒绝非 HTTPS 顶层导航、带凭据 URL、反斜杠、控制字符、过长 URL 和本地文件访问
- 禁止混合内容，证书错误直接取消请求，不提供跳过验证入口
- 不允许原生多窗口，不依赖弹窗登录，当前网页登录使用顶层导航，新增弹窗流程前需单独评估
- 网络失败重试总是返回首页，不重放 OAuth 回调 code，也不清除 Cookie 或网页存储
- 不记录完整 URL、OAuth 参数、Cookie 或 token，当前错误提示和少量日志不是完整监控系统

## 验收清单

### 启动、布局与网络

- [ ] API 18 工具链通过 ArkTS 检查，debug 和 release 都能构建，并分别验收兼容设备版本
- [ ] 手机窄屏、横屏和平板检查网页、系统状态栏、键盘、安全区和返回手势
- [ ] 空站点配置显示提示，合法配置加载网页，错误配置不能加载任意页面
- [ ] 弱网和断网出现失败或超时提示，恢复网络后点击重试可回到首页
- [ ] 主文档 4xx / 5xx 显示重试提示，单个图片、接口或音频失败不会替换整个网页
- [ ] 无效证书与 HTTP 跳转被拒绝，普通 HTTPS 外链在用户手势下打开浏览器

### 登录、房间与媒体

- [ ] 未登录可浏览首页，加入房间和音乐服务仍要求账户登录
- [ ] GitHub / Linux.do 登录、取消授权、过期与回调失败流程正常，错误页面可返回首页重试
- [ ] 管理员登录与绑定不泄露后台入口或凭据，网页仍执行原有权限检查
- [ ] 账户切换、重启应用和覆盖升级保持预期登录行为，不从原生端读写刷新凭证
- [ ] 房间加入、点歌、聊天、收藏使用现有服务端链路，未认证和无权限操作仍被拒绝
- [ ] 用户主动点击播放后声音、歌词、暂停、跳转和音源编码表现正常
- [ ] 自动播放被系统限制时网页仍能通过手动播放恢复，不把手势策略当作权限校验
- [ ] 断网重连、切回前台后的房间与队列由网页重新同步，壳不另建恢复逻辑
- [ ] 不出现 Android 通知栏、悬浮歌词或原生工具可用的错误提示
- [ ] `target=_blank`、外部 HTTPS 链接及嵌入页面不会绕过导航边界

### 系统音乐卡片与后台音频

- [ ] 播放后控制中心／通知区域和锁屏出现正确的歌曲、歌手、进度及应用封面，点击卡片返回应用
- [ ] 后台和熄屏连续播放至少 30 分钟，连续自动切换至少 3 首歌曲，卡片不因普通切歌重建或消失
- [ ] 有权限时系统播放／暂停、下一首与进度拖动正常，无权限和房间禁用的操作不能绕过网页／服务端裁决
- [ ] 暂停后后台任务释放，AVSession 仍保留，恢复播放后重新申请任务，离房后会话和任务均清理
- [ ] 来电、其他播放器、蓝牙和耳机切换后，卡片状态与真实音频一致，不因房间仍显示播放而伪造后台运行
- [ ] 用户关闭卡片或取消后台任务后，不在后台依靠周期状态上报强制重建，回到应用恢复播放后才能重新接入
- [ ] 系统回收后台任务与用户取消区分处理，系统回收时保留暂停会话，真实音频恢复后重新申请
- [ ] 长时任务被拒绝时显示提示，网页前台功能继续可用，不以静音音频或无效任务绕过系统管理
- [ ] 汽水验证 iframe 在鸿蒙环境使用 opaque origin，无法读取顶层令牌，同时完成真实扫码二次验证回归

卡片的显示位置、暂停后保留时长与用户移除行为由系统管理，源码接入不等于已经证明特定设备可永久常驻，不承诺强杀、重启或系统撤销任务后继续播放

## 自动检查边界

导航策略使用独立 TypeScript 文件，可在 Node 中注入标准 URL 解析器执行逻辑测试，设备上通过 `ArkWebPolicy.ets` 注入鸿蒙 `url.URL.parseURL`

Node 测试不能代替鸿蒙 URL 解析器兼容性、ArkTS 编译、ArkWeb 事件顺序、证书行为和设备验收

2026-10-27 基础壳验证：9 项导航策略检查、8 项页面非 UI 方法检查、9 项工程预检检查均通过，共 26 项

页面方法测试在 Node 沙箱中替代了系统控制器、浏览器拉起和提示接口，只验证同步与异步失败处理、超时清理、重试和返回逻辑，不涉及 ArkUI 布局或原生运行时

测试先复现了浏览器同步拉起异常、提示不可用、超时停止加载异常和重试异常，再验证修复，不将转译后的方法检查描述为 ArkTS 编译成功

默认空站点的普通预检通过并警告，发布预检按预期失败，临时测试脚本与夹具已清理，长期保留的工程检查入口是 `scripts/check-project.mjs`

本次开发环境未检测到可用的 DevEco / Hvigor 命令，未生成 HAP，未完成鸿蒙原生 UI 可视化检查，上述待验收项不能视为已通过

媒体接入另执行 34 项 Node 检查，覆盖协议、重放与来源校验、权限、AVSession 复用、后台任务竞态、失败重试、系统取消、前台恢复和配置门禁，原生系统 API 使用替代实现，不代表实际设备或 ArkTS 编译已通过

已同步更新 `client/src/lib/userGuide.ts` 的播放器步骤，说明鸿蒙系统卡片、房间权限以及暂停／离房清理行为

## 发布与回滚

- 首版不修改服务端协议、Redis 数据或 Android 构建，无数据迁移，不要求升级服务端
- 先部署带独立鸿蒙桥接及 iframe 隔离的兼容网页，再升级鸿蒙包，旧网页没有鸿蒙握手时只能按普通网页使用，不能据此验收后台播放
- 实际发包前记录版本、负责人、站点 Origin、签名标识、上述验收结果及未解决问题
- 发现登录失败、后台中断、卡片重复、权限绕过或退出后资源不释放时停止分发该版本
- 恢复上一已验收版本的源码与站点配置，保持包名和签名，用更高 versionCode 重新构建修复包，避免要求用户卸载清除数据
- Android APK 与现有网页版可继续独立使用，首发尚无历史鸿蒙版本时暂停鸿蒙分发即可

## 官方参考

- ArkWeb 导航、加载和证书事件：https://developer.huawei.com/consumer/cn/doc/harmonyos-references/ts-basic-components-web
- OpenHarmony ArkWeb 事件说明：https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-arkweb/arkts-basic-components-web-events.md
- URL 解析 API：https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-arkts/js-apis-url.md
- 后台音频场景：https://github.com/openharmony/docs/blob/master/en/application-dev/media/avsession/avsession-background-scene.md
- 长时任务：https://github.com/openharmony/docs/blob/master/en/application-dev/task-management/continuous-task.md
