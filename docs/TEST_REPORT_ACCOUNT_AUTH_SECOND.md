# 第二推送自测报告：第三方登录与多身份绑定

## 范围

- Linux Do、GitHub 两种第三方身份接入统一账户体系；微信账户入口仅作预留，暂未开放。
- 第三方首次登录创建独立账户，不读取第三方邮箱进行静默合并。
- 同一账户可分别绑定 Linux Do 和 GitHub；同一提供方在一个账户内只保留一个身份。
- 全局身份索引阻止同一第三方身份绑定到多个账户。
- 解绑前检查剩余登录方式，禁止解绑后账户无法再次登录。
- 首页新增登录/游客选择和“账户与安全”入口，覆盖桌面和窄屏布局。
- 保留原有房主身份找回、管理员第三方登录及历史 Redis 绑定，不自动迁移。

## 实现与安全边界

- 账户身份使用 `provider + subject` 作为唯一标识，第三方展示名、头像和邮箱均不参与账户归属判断。
- Redis 新增第三方身份索引；账户创建、绑定、冲突判断、解绑和索引清理通过 Lua 原子执行。
- OAuth `account-bind` 的签名 state 记录当前账户 ID，回调时再次核验 HttpOnly 账户会话，不能只依赖回调参数。
- Linux Do 和 GitHub 复用原有授权、Token、用户资料解析、回调地址与限流逻辑。
- 微信账户登录接口当前明确关闭并返回稳定错误；页面保留不可点击入口。原文件传输助手采集、房主 UIN 绑定和找回能力保持不变。
- 账户会话继续使用独立 HttpOnly Cookie，不覆盖匿名房间身份；游客路径和原房间功能保持可用。
- 账户接口只返回身份提供方、展示名、头像和绑定时间，不返回第三方 subject、Token、Cookie 或密钥。

## 自动化验证

| 检查 | 命令或方式 | 结果 |
| --- | --- | --- |
| 服务端语法检查 | `node --check server/index.js`、`accountAuth.js`、`wechatFileHelperProxy.js` | 通过 |
| 服务端 lint | `npm run lint --prefix server` | 通过 |
| 服务端全量测试 | `npm test --prefix server` | 84 项：81 通过，3 项按环境跳过，0 失败 |
| 客户端测试 | `npm test --prefix client` | 16 项通过，0 失败 |
| 客户端类型检查 | `npm run typecheck --prefix client` | 通过 |
| Ant Design 边界 | `npm run check:antd-boundary --prefix client` | 通过，普通用户页面未引入 Ant Design |
| 客户端生产构建 | `npm run build:check --prefix client` | 通过 |
| 桌面浏览器冒烟 | Playwright，1440×1000 | 首次登录/游客选择、邮箱/Linux Do/GitHub 可用入口与微信预留入口均可见，控制台无错误 |
| 窄屏浏览器冒烟 | Playwright，390×844，模拟已登录账户 | 账户安全页、已绑定身份、待绑定身份和退出入口均可见，控制台无错误 |
| 运行配置探测 | 本地服务 `GET /api/auth/providers` | Linux Do、GitHub 按配置启用；微信账户登录固定返回 `false` |
| OAuth 起始路由 | Linux Do/GitHub `purpose=account-login` | 均返回 HTTP 302 授权跳转 |
| 隔离 Redis 原子流程 | 本地 Redis DB 14（确认初始为空，结束后清空） | 创建账户、多身份绑定、冲突拒绝、解绑及索引释放通过 |
| 差异检查 | `git diff --check` | 通过，仅有 Git 换行符提示 |

## 新增测试覆盖

- 相同 `provider + subject` 重复登录复用原账户。
- OAuth 资料即使包含相同邮箱，也不会与邮箱账户合并。
- 邮箱账户同时绑定 Linux Do 和 GitHub。
- 已属于其他账户的身份绑定返回冲突，原归属保持不变。
- 外部身份账户只剩一种登录方式时拒绝解绑。
- 解绑成功后删除身份索引，原身份可以用于创建或绑定其他账户。
- 微信扫码证明签名校验和篡改拒绝。
- 账户公开认证路由在匿名 API 签名门槛前正确放行，并由各路由执行自身认证校验。

## 未验证项

- 邮箱、Linux Do 和 GitHub 登录闭环已由用户手动验证并提供截图；自动化检查不替代线上环境回归。
- 微信文件传输助手扫码目前可进入会话中转，但真实扫码在 `webwxinit` 返回 `1100`；微信账户登录闭环尚未通过，不应视为可用登录方式。
- 已确认 Linux Do/GitHub 授权起始路由可生成跳转；微信账户登录暂不进入本次发布验收范围。
- 已在隔离 Redis DB 上执行原子写入闭环；未执行多实例并发压力测试，生产环境仍需保持 Redis 可用和持久化。

## 上线与回滚

- 无一次性迁移脚本。旧账户在首次读取或更新时兼容旧 `identities[].createdAt` 字段；旧房主/管理员绑定键保持不变。
- 发布顺序：先部署服务端，再发布客户端静态资源；确认 `/api/auth/providers`、`/api/auth/session` 和 OAuth 回调可访问。
- 重点观察 `account_auth_total` 中登录、绑定、解绑、冲突、限流和错误结果，以及 OAuth 上游错误日志；日志不包含 Token、Cookie 和密钥。
- 回滚可恢复上一版本服务端和客户端。新增账户及身份索引会留在 Redis 中但旧版本不会读取，不影响原有邮箱登录和房间身份数据；再次升级后可继续使用。
