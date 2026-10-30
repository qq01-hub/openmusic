# OpenMusic 与 Meting 错误对接

更新日期：2026-10-30

## 对接边界

本次核对 OpenMusic 实际调用的 Meting `/api`、`/admin/openmusic`、`/admin/fm`、Cookie 管理、扫码登录和汽水验证资源接口

OpenMusic 入口包括 `/api/meting`、会员贡献 HTTP 接口、房间音乐账号 Socket 事件及后台自动漫游

本站用户登录、Meting 服务间授权和音乐平台账号是三个独立的身份域，不能仅凭 HTTP 401 或 403 将它们互相替代

## 状态与错误码

| 场景 | Meting 响应 | OpenMusic 对外含义 | 行为 |
| --- | --- | --- | --- |
| 请求成功，有歌曲或播放地址 | 200，正常业务数据 | 成功 | 正常消费 |
| 推荐请求成功，但没有可用候选 | 200，空数组或 `success:true,data:[]` | 正常空结果 | 可以尝试公共池，最终无歌曲时按房间冷却重试 |
| 明确的房间音乐账号登录失效 | 422，`MUSIC_ACCOUNT_INVALID`，`success:false` | 音乐账号需要重新登录 | 对比请求使用的旧 Cookie 后停用凭证，保留失效账号信息，通知房间，尝试公共池 |
| 公共池没有可用账号 | 503，`MUSIC_ACCOUNT_UNAVAILABLE` | 音源账号暂不可用 | 不使房间账号失效，不按整个 Meting 宕机冷却 |
| 音乐账号需要官方验证 | 422，`MUSIC_VERIFICATION_REQUIRED` | 账号验证未完成 | 保留凭证，不等同歌曲永久无源 |
| 已完成取链请求，但没有可播放地址 | 403，`MUSIC_URL_UNAVAILABLE` | 曲目业务无链 | 保留兼容的 `error:no url`，可换源，不按整站故障冷却 |
| 所有取链或推荐请求均发生异常 | 502，`UPSTREAM_REQUEST_FAILED` | 上游请求失败 | 不伪装成无歌曲或无播放地址 |
| 上游请求超时 | 504，`UPSTREAM_TIMEOUT` | 上游超时 | 可重试，不标记音乐账号失效 |
| API Token、签名或权限校验失败 | Meting 返回 401/403，或 `OPENMUSIC_AUTH_REQUIRED`、`OPENMUSIC_REPLAY` | 502，`METING_AUTH_FAILED` | 提示检查服务间配置，不触发本站用户退出或音乐账号失效 |
| Meting 授权校验繁忙 | 503，`OPENMUSIC_AUTH_BUSY` | 503，`METING_BUSY` | 临时故障，不当成授权配置错误 |
| 参数错误 | 400，参数错误码 | 400，保留明确错误码，无码旧响应使用 `METING_INVALID_REQUEST` | 修正参数 |
| 资源不存在 | 404 | 404，保留明确错误码，无码旧响应使用 `METING_RESOURCE_NOT_FOUND` | 不当成服务宕机 |
| 请求被限流 | 429 | 429，保留明确错误码，无码旧响应使用 `METING_RATE_LIMITED` | 等待后重试 |
| 未配置 Meting 地址或 Token | 不发上游请求 | 503，`METING_NOT_CONFIGURED` | 管理后台补充配置 |
| 管理接口返回 HTML、空正文或无效 JSON | 200，但不是有效管理响应 | 502，`METING_INVALID_RESPONSE` | 不消费为成功结果 |
| 旧镜像返回 200 + `success:false` | HTTP 200，业务失败 | 按明确业务码映射，否则 502，`METING_OPERATION_FAILED` | 不能把内部失败继续传成 HTTP 200 |

`success` 描述该次接口操作是否完成，`code` 是稳定的业务标识，HTTP 状态表示请求结果的大类

Cookie 验证接口的 `success:true,data.valid:false` 表示“验证操作成功，账号验证不通过”，扫码接口的 waiting、scanned、expired 等状态也是正常的流程结果，不能把这些字段中的数字或状态统一当作 HTTP 错误

`FM_ACCOUNT_FAILED`、`FM_EMPTY_RESULT`、`URL_ACCOUNT_FAILED` 等历史日志标签不是完整的响应协议，调用方应读取响应的 HTTP 状态及正式 `code`

Meting 私有 FM 错误由统一 HTTP 日志出口记录一次，保存独立的 `code` 与平台字段，业务 4xx 使用警告级别，基础设施 5xx 使用错误级别，公共池无可用账号的 503 使用警告级别，账号池内的逐账号失败记录与最终请求记录仍是不同的观测事件

## 回退、重试与缓存

- 私有 FM 失败后，公共回退通过服务端请求上下文显式选择 `/api`，保留房间日志归因，但不携带 `roomId` 查询参数或 `X-OpenMusic-Cookie`
- 确认失效后，同一轮不再请求旧 Cookie，后续房间请求跳过 `isValid:false` 的账号
- 普通私有音乐请求收到明确账号失效码时，也会停用旧凭证并转向公共池
- 旧请求返回期间若已重新登录，只处理与该请求相同的旧 Cookie，不能清除新账号
- 账号失效、缺少公共账号、官方验证、单曲无链不进入整站硬失败冷却
- 网络故障、超时和服务间鉴权错误保留硬失败记录，公共业务失败不冒充成功
- HTTP 错误响应不写入 Meting 歌曲和播放地址缓存，避免账号恢复后继续命中之前的 403/422/503
- 仅返回空列表但没有明确失效依据时，不推断 Cookie 已过期

## 平台错误的处理

QQ 的明确登录失效异常、网易的登录错误 301，以及 Provider 明确返回的未登录、凭证过期错误会映射到音乐账号失效

Provider 请求中的 HTTP 401 属于音乐平台身份域，Meting 程序化入口的 HTTP 401 属于服务间授权域，两者必须在各自边界处理

汽水与酷狗的 FM 请求异常交给统一处理或账号池切换，不再吞成成功空列表

不会根据不明的平台数字码推断登录失效，新的平台状态码需要有对应来源和验证案例

## 发布与回滚

版本记录：2026-10-30 错误协议联调修复，待部署

先部署兼容旧响应的 OpenMusic 服务端，再部署 Meting，最后更新网页资源

不需要 Redis 数据结构迁移或新增运行时配置，既有房间凭证仍采用原来的加密和持久化链路

上线观察 `MUSIC_ACCOUNT_INVALID`、`METING_AUTH_FAILED`、`UPSTREAM_TIMEOUT`、公共 `/api` 的实际请求和整站冷却统计，不能仅凭 200 数量判断漫游成功

本地验证使用受控 HTTP 上游和接口测试，没有用生产 Cookie 实测线上音乐平台，也没有进行真实 iPhone 验证

回滚时恢复本次源码修改并重新构建、重启对应服务，不回退其他已有工作区改动，已确认失效并清除的凭证需要重新登录，回滚不会恢复旧 Cookie

实际部署版本、负责人和线上验收记录由执行发布时补充
