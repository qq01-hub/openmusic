# 第一推送自测报告：账户基础与邮箱认证

## 范围

- 统一账户记录、邮箱身份和账户会话。
- 邮箱验证码注册：验证码校验通过后设置密码。
- 邮箱/密码登录、账户会话查询、注销。
- 账户会话使用独立 HttpOnly Cookie，不覆盖现有匿名会话。
- 本推送不包含 OAuth、收藏同步、房间所有权和登录入口 UI。

## 自动化验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 服务端 lint | `npm run lint --prefix server` | 通过 |
| 服务端全量测试 | `npm test --prefix server` | 80 项：77 通过，3 项按环境跳过 |
| 客户端测试 | `npm test --prefix client` | 16 项通过 |
| 客户端类型检查 | `npm run typecheck --prefix client` | 通过 |
| Ant Design 边界检查 | `npm run check:antd-boundary --prefix client` | 通过 |
| 客户端生产构建 | `npm run build:check --prefix client` | 通过 |
| 仓库级检查 | `npm run check` | 通过 |
| 补充差异检查 | `git diff --check` | 通过（仅有换行符提示） |
| 隔离 Redis 账户流程 | 临时 Redis `127.0.0.1:6390` + 注册/登录/会话注销脚本 | 通过 |
| 真实 SMTP 验证码投递 | `POST /api/auth/email/code` + 测试邮箱（已脱敏） | 通过，邮件实际到达 |
| 真实邮箱注册与密码登录 | 使用邮件验证码完成注册、密码登录和会话查询 | 通过 |
| Redis RDB 重启恢复 | `BGSAVE` → `docker restart redis` → `PING`/会话/登录验证 | 通过 |

## 认证模块覆盖场景

- 邮箱大小写和空白归一化、无效邮箱拒绝。
- 密码长度 8–128 位校验。
- 验证码生成、发送回调和有效期返回。
- 验证码错误次数限制，超过 5 次失效。
- 注册成功写入邮箱索引和账户记录，并创建账户会话。
- 重复邮箱注册拒绝。
- 正确密码登录、错误密码拒绝。
- 会话解析、滑动续期和注销后的失效。
- 账户认证接口不会被匿名 API 请求签名门槛拦截。
- 认证路由记录成功、失败、拒绝/限流和会话状态指标（不包含邮箱、密码、验证码或 Cookie）。

## 未覆盖项与上线前检查

- 已在 Docker Redis 容器上完成一次 RDB 受控重启恢复验证：重启前执行 `BGSAVE` 并确认状态为 `ok`；重启后 `PING=PONG`、`loading=0`、`rdb_last_bgsave_status=ok`，账户会话和密码登录均恢复正常。该实例挂载 Docker volume 到 `/data`，AOF 当前未启用（`aof_enabled=0`）。
- 尚未覆盖 Redis 突然崩溃时 RDB 最近快照间隔内的数据损失、AOF 策略、多实例压力和故障切换；生产环境可根据数据丢失容忍度评估启用 AOF，并确认持久化卷和备份策略。
- 已完成一次真实 SMTP 投递、验证码注册和密码登录；尚未覆盖不同邮箱服务商的 TLS 组合、退信、灰度限流和长期投递稳定性。
- 未执行真实浏览器登录交互；本推送尚未加入登录/注册 UI，下一推送接入。
