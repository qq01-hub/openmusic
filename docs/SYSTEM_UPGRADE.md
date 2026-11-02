# 管理端系统升级

管理后台 → 系统设置 → 系统升级 → 检查更新 → 升级到最新正式版

升级只接受 `qq01-hub/openmusic` 的正式 Release，不提供任意 URL、命令或上传包执行入口
管理员须完成初始安全设置，写操作继续校验会话与请求来源，提交与拒绝记录写入后台审计

## 部署方式

| 方式 | 执行动作 | 前置条件 |
| --- | --- | --- |
| Docker 一键部署 / 仓库 Compose | 拉取 `w3126197382/openmusic:<正式版本标签>` 并替换应用容器 | 同一 Compose 项目的 `updater` 服务已运行，使用默认应用入口与容器端口 4000 |
| Linux / macOS 源码或发布包部署 | 下载 `openmusic-build.zip`，校验 SHA256，准备生产依赖，再通过 PM2 重启 | Node.js 20～24、npm、同一用户的 PM2 与 `openmusic-updater` 进程 |
| 直接 `npm start`、Windows、其他自定义进程管理器 | 不提供自动替换 | 管理端提示未接入，先迁移到受支持的部署方式 |

新安装使用仓库 Compose 或 `deploy/deploy.sh source` 会接入升级服务
升级服务是独立进程，主站重启期间仍能完成升级、保留任务状态与恢复操作
管理会话在主站重启后失效，重新登录即可查看持久化的结果

## 旧 Docker 部署接入一次

先备份部署目录 `.env`、`data/` 和 Redis 卷，保留原 Compose 项目名、目录及网络设置
将部署使用的 Compose 文件更新到包含本功能的版本，应用镜像也须包含 `deploy/updater`
只在独立 `updater` 容器挂载 Docker socket，主站不挂载 Docker socket，控制通道通过共享卷中的 Unix socket 提供，不开放新端口

一键全量部署在原部署目录执行，保留原 `.env` 和持久化文件

```bash
docker compose --env-file .env -f docker-compose.full.yml pull openmusic updater
docker compose --env-file .env -f docker-compose.full.yml up -d --no-build --no-deps openmusic updater
```

精简版使用 `-f docker-compose.yml`
响度增强版沿用 `-f docker-compose.full.yml -f docker-compose.loudness.yml`
不要新建不同名称的 Compose 项目，也不要执行 `down -v`

Docker socket 具有宿主机 Docker 控制权限，独立升级容器及共享控制卷仅供可信管理员使用
多副本、自定义启动命令、非官方镜像、`container:` 网络模式和自动删除容器不支持自动升级
后台只更新 OpenMusic，不自动升级 Redis、Meting、响度服务或升级服务自身

## 旧源码 / 宝塔部署接入一次

把包含本功能的 `deploy/`、服务端和前端构建部署到原项目根目录后，使用原 PM2 用户执行

```bash
npm ci --prefix deploy/updater --omit=dev
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
```

不要用不同系统用户创建第二套 PM2
已有配置继续通过管理后台维护，无需为版本选择新增 `.env` 配置
源码升级下载的是已构建的发布包，只替换运行中的 `server/` 代码、生产依赖和 `client/dist/`
Git 索引及 `client/src/` 等开发源码不会同步变成目标标签，线上机器请继续使用后台更新，开发工作区通过 Git 管理
首次升级拒绝有未提交服务端或前端源码修改的 Git 工作区，后续按已安装服务端文件摘要检查手工变更

## 升级过程与保护范围

1. 检查官方最新正式发布，展示版本与发布说明，检查结果短时缓存
2. 管理员确认短暂停机，服务端校验已检查的 Release ID 并拒绝并行升级
3. Docker 先拉取镜像，源码先下载、限量解压与安装生产依赖，此阶段原服务保持运行
4. 记录恢复日志后切换代码或容器，保留 `.env`、运行配置、管理员配置、下载文件、卷挂载及 Redis 数据
5. 等待 `/api/health` 响应；Docker 同时核对运行状态与镜像 ID，此检查仅证明进程可响应，不代表 Redis 或音乐上游全部健康
6. 切换失败尝试恢复旧代码 / 容器，升级进程意外重启时根据恢复日志继续恢复

ZIP 限制为 300 MiB，解压总量限制为 1.5 GiB，拒绝路径穿越、符号链接、重复路径与覆盖运行配置
下载仅允许官方 GitHub HTTPS 地址，每次重定向都重新校验目标和 DNS 公网地址
源码生产依赖安装使用 `npm ci --omit=dev --ignore-scripts`，未来依赖必须执行安装脚本时须先评估兼容性

应用不在升级中修改 Redis 数据模型，不自动清空房间或收藏
升级引入的数据迁移仍须由对应版本提供独立兼容与回退说明，代码回退不能代替数据备份

## 失败处理与回滚

- 管理端显示恢复中：等待任务结束并重新登录查看
- 显示准备失败：下载、校验或安装依赖未完成，原服务继续运行，修复网络或环境后重试
- 显示已恢复原版本：原服务已保留 / 恢复，检查网络、磁盘空间、npm 和 PM2 环境后重新检查版本
- 显示需要人工恢复：停止升级服务，保留恢复日志与备份，通过服务器终端处理，避免重复覆盖恢复现场

源码任务与备份在项目根目录 `.openmusic-update/`，`state.json` 的 `job.transaction.backup` 指向该次旧服务端和旧前端目录
旧服务端备份不包含已迁回当前目录的运行配置，人工回退时须先停主站，再把当前运行配置与下载目录迁回旧服务端，不能直接覆盖丢弃
Docker 事务日志在 `openmusic-update` 命名卷，记录 `oldImage` 和原容器 ID，失败时自动恢复原容器
升级成功状态落盘后清理旧容器，但保留旧镜像及数据卷；人工回退可用原 Compose 配置将应用镜像固定到旧镜像 ID 后重建主站

查看升级日志

```bash
# Docker，全量版示例
docker compose --env-file .env -f docker-compose.full.yml logs --tail=100 updater

# 源码
pm2 logs openmusic-updater --lines 100
```

日志记录任务阶段、结果和拒绝原因，不输出凭据，不等同于完整监控与告警
源码会保留各次升级的代码备份和下载包，管理员在确认版本稳定后清理不再需要的历史备份

## 发布要求

推送正式 `v*` 标签后，`Docker Publish` 构建对应标签镜像，`Server Release ZIP` 构建并上传 `openmusic-build.zip`
后台仅选择最新非草稿、非预发布的正式 Release，GitHub 附件须提供 SHA256 digest
发布包和镜像尚未全部就绪时请等待发布工作流完成后再升级
发布记录需注明版本、负责人、变更摘要、配置 / 数据迁移、验收结果和回滚触发条件

普通访客新人指引仅覆盖大厅与房间，本功能只在管理后台出现，不增加普通用户引导步骤
