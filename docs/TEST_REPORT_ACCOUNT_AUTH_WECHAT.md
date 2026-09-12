# 第三次推送自测报告：微信扫码登录、身份同步与会话重定向

## 1. 基本信息

- 验证日期：2026-09-12
- 当前分支：`main`
- 当前提交：`c5c2c74 fix: follow wechat login redirect session`
- 关联功能提交：
  - `8012295 feat: 增加邮箱验证码账户认证`
  - `807208c feat: add multi-provider account login`
  - `30ab57b feat: enable wechat account login identity sync`
  - `c5c2c74 fix: follow wechat login redirect session`
- PR 方向：`LiuAndIce/openmusic:main` → `qq01-hub/openmusic:main`

本报告为新增文档。此前的
[`TEST_REPORT_ACCOUNT_AUTH.md`](./TEST_REPORT_ACCOUNT_AUTH.md)
和
[`TEST_REPORT_ACCOUNT_AUTH_SECOND.md`](./TEST_REPORT_ACCOUNT_AUTH_SECOND.md)
保留不变。

## 2. 本次 PR 范围

本 PR 汇总了上游尚未合并的账户认证基础和本次微信登录功能，主要包括：

- 邮箱验证码账户认证与密码登录基础。
- Linux Do、GitHub、微信三类身份接入同一账户体系。
- 使用 `provider + subject` 唯一识别第三方身份，禁止按邮箱静默合并。
- 一个账户绑定多个身份，并在解绑前检查剩余登录方式。
- 微信复用文件传输助手扫码建立账户登录会话。
- 微信首次登录优先继承当前游客的稳定房间 `userId`，后续登录恢复同一房间身份。
- 登录成功后刷新 Socket 会话和账户收藏；注销账户后切换为新的游客身份。
- 服务端只接受完整微信会话后签发的短期登录证明，不直接信任前端提交的 `wxuin`。
- 微信登录页支持 HTTP 重定向和 XML `<redirecturl>`，并使用最终微信域名请求 `webwxinit/webwxsync`。
- 微信登录跳转地址限制为 HTTPS QQ 域名，最多跟随 3 次；错误信息不回显 ticket、Cookie 或其他凭据。
- 更新账户入口、用户指南、README 和 release notes。

## 3. 人工验收

| 场景 | 操作 | 结果 |
| --- | --- | --- |
| 微信扫码登录 | 打开“账户与安全”，进入微信登录并完成文件传输助手扫码确认 | 通过；登录会话建立并进入账户流程 |
| 微信身份绑定 | 登录已有账户后查看身份列表 | 通过；页面显示邮箱、Linux Do、GitHub 和微信共 4 类身份（展示信息已脱敏） |
| 账户与游客并存 | 保持游客房间功能并使用账户入口 | 通过；游客入口仍保留，账户入口不替代游客模式 |
| 账户安全页面 | 查看已绑定身份、绑定入口和退出账户入口 | 通过；页面可正常显示并操作 |

人工验证未记录真实邮箱、微信号、Cookie、ticket 或会话字段。

## 4. 自动化与静态检查

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 账户认证与微信证明测试 | `node --test server/accountAuth.test.js server/apiSign.test.js server/wechatFileHelperProxy.test.js` | 通过，9/9 |
| 服务端测试脚本 | `npm test --prefix server` | 通过（ESLint 检查） |
| 服务端语法检查 | `node --check server/index.js`、`server/accountAuth.js`、`server/wechatFileHelperProxy.js` | 通过 |
| 客户端类型检查 | `npm run typecheck --prefix client` | 通过 |
| Ant Design 引入边界 | `npm run check:antd-boundary --prefix client` | 通过 |
| 客户端生产构建 | `npm run build:check --prefix client` | 通过 |
| Git 差异检查 | `git diff --check` | 通过 |
| 微信重定向临时回归 | 模拟 XML `<redirecturl>`、最终 QQ 域名和非法外部域名 | 通过，2/2；临时测试文件已删除 |

## 5. 关键安全与兼容性检查

- `wxuin` 只作为已验证微信会话中的身份字段使用，不能单独换取账户登录。
- 微信完整会话凭据仅在浏览器代理和服务端验证链路内使用，不上传到账户接口，也不写入日志或 PR 文档。
- 账户会话继续使用独立 HttpOnly Cookie，不覆盖匿名房间身份。
- Redis 账户、身份索引和房间身份映射保持服务端裁决；生产环境仍要求 Redis 可用。
- 旧账户可读取旧身份记录格式；本次没有一次性迁移脚本。
- 未修改移动端桥接事件和房间公共协议；游客建房、进房、点歌功能保持可用。

## 6. 未覆盖项与风险

- 尚未覆盖不同微信域名、不同网络出口和生产 Nginx/CDN 对重定向的组合差异。
- 尚未进行多浏览器并发登录、断线重连和 Redis 故障切换压力测试。
- 当前人工验收确认了微信登录和身份列表展示，跨设备重新登录后完整恢复收藏的长期回归仍需上线环境继续观察。
- 构建时提示未配置 `SITE_CANONICAL_URL`；该提示不影响本次账户认证和微信登录代码。

## 7. 发布与回滚

- 发布顺序：先部署服务端，再发布客户端静态资源，确认 `/api/auth/providers`、`/api/auth/session` 和微信账户认证接口可访问。
- 重点观察：账户登录、微信证明签发/拒绝、身份绑定冲突、Socket 重连、收藏加载和上游微信请求失败。
- 日志不得记录 token、Cookie、ticket、pass_ticket、skey 或完整 XML。
- 无配置和数据迁移要求；如需回滚，恢复上一版服务端和客户端即可，新增 Redis 账户数据会保留但旧版本不会读取。

## 8. PR 变更说明（可直接粘贴）

### 标题

`feat: 完善账户认证与微信扫码登录`

### 描述

```markdown
## 变更内容

- 增加邮箱验证码、密码和多提供商账户认证基础
- 支持 Linux Do、GitHub、微信身份绑定到同一账户
- 微信复用文件传输助手扫码建立登录会话
- 登录后同步稳定房间身份、Socket 会话和账户收藏
- 修复微信登录 `webwxnewloginpage` 的 HTTP/XML 重定向处理
- 使用最终微信域名请求 `webwxinit/webwxsync`
- 限制微信跳转目标为 HTTPS QQ 域名，并限制重定向次数
- 更新账户入口、用户指南、README 和 release notes

## 安全说明

- 不直接信任前端提交的 `wxuin`
- 由服务端验证完整微信会话后签发短期登录证明
- 不在日志、响应或文档中输出 Cookie、token、ticket 或 pass_ticket

## 验证

- 微信扫码登录和账户身份绑定已人工验证
- 服务端认证与证明测试 9/9 通过
- 客户端 typecheck、Ant Design 边界检查和生产构建通过
- 服务端语法检查、ESLint 和 Git 差异检查通过

## 说明

本 PR 汇总此前尚未合并的账户认证提交，并替代已关闭的微信登录旧 PR。
```
