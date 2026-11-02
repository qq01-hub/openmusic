# 桌宠源码移植对照

形象、动作与物理基于固定版本的实际源码，角色图像使用原版素材，不自行绘制

| 上游 | 固定提交 |
| --- | --- |
| shenliuyu18/dafeiyu-pet | 4d9aadf05af87d94ecadc05bd206fc94cb6eb639 |
| PC2005-cloud/dsh-pet | 09aa6c3beae269e3ab0738a1d4c84066e5c03a23 |

| 上游源码 | 本地实现 | 保留的行为 |
| --- | --- | --- |
| dafeiyu-pet renderer/pet.js CHARS / ANIM | client/src/lib/deskPetUpstream.ts、deskPetCharacters.ts | 7 套形象、各自动作列表、待机池、动作映射和未知动作回退池 |
| web/index.html 形象列表 / web/assets/chars | client/src/components/DeskPetCharacterPicker.tsx、public/desk-pet/previews | v2～v6 与 GPT 娘使用原站对应缩略图与说明，v1 按用户偏好保留 idle.png 待机画面缩略图 |
| renderer/pet.js poseForName / playAnim | client/src/lib/deskPetCharacters.ts | 立绘不镜像，带文字视频不镜像 |
| renderer/pet.js SPRITE / SPRITE_MAP / spriteTick | client/src/components/DeskPetAppearance.tsx | 图集原始逐帧时长、左右独立奔跑、16 方向视线 |
| renderer/pet.js playOnce | client/src/components/DeskPetAppearance.tsx | 视频 ended 返回基础状态、metadata 时长兜底、动作切换清理旧计时器、立绘 2600ms、图集时长加 220ms |
| renderer/pet.js maybeShow / pickWeighted | client/src/lib/deskPetCharacters.ts、RoomAiDesktopPet.tsx | 40 秒自动节目间隔、250ms 心跳、原版节目分组与 GPT 专属动作池，视频节目补齐全量覆盖与轮内去重 |
| renderer/style.css poseAlive / posePop | client/src/components/RoomAiDesktopPet.css | 立绘呼吸与姿势切换弹性动画，尊重减少动态效果偏好 |
| dsh-pet src/shared/physics/constants.ts / spring.ts | client/src/lib/deskPetPhysics.ts | K200/C30 弹簧拖拽 |
| src/shared/physics/release.ts | 同上 | 150ms 释放窗口、峰值与加速加权、死区、软限速 |
| src/shared/physics/throw.ts / contact.ts / squash.ts | 同上 | 重力 1400、恢复系数 0.78、切向摩擦、四边碰撞与静止、8px 子步进、弹射力度按角色宽度归一化 |

## 音乐房间适配范围

- 替换为音乐相关气泡、食物文案与听歌账本，保留房间组件探头、观察、虚拟戳按钮等交互
- 动作选择器按当前形象实际动作列表展示，v1 的 106 个原版视频全部支持分类、名称搜索与手动点播，工作与账本分类包含完整六档账本动画
- 视频发布文件名仅使用 ASCII：`anim-<动作名各 Unicode 码点的小写十六进制，以连字符分隔>.webm`，运行时按相同规则解析，动作中文展示名称和视频内容保持不变，避免服务器解压中文文件名乱码造成 404
- 从中文文件名版本更新时，需同时部署新版前端 JS 与完整 `client/dist/desk-pet/`，刷新 HTML/CDN 缓存并重新加载页面，避免旧 JS 继续请求中文路径
- 漫游、房间组件互动与音乐气泡共用个人开关下的调度，开启玩耍后，100 个表演视频加入自动节目轮换，一轮播完后才重复，放歌时优先选择尚未表演的音乐与舞蹈动作
- 待机 1 个、漫游 3 个、拖拽 1 个、睡眠 1 个视频在对应状态触发，不混入普通表演；轮换进度仅保留在当前组件实例，切换形象或重新进入房间后开始新一轮
- 单次动作播放期间，切歌或 AI 回复只更新气泡，不抢占动作；视频结束后返回当前工作或待机状态，用户主动点播、拖拽或关闭仍可打断
- v2～v6 使用各自原版立绘，完整接入 18 / 32 / 32 / 16 / 2 个姿势，手动点播和自动节目共用完整列表，自动轮换一轮内不重复
- GPT 娘接入 10 套图集序列，包含原菜单的 9 套动作及闭眼休息，并保留待机时跟随鼠标的 16 方向视线帧
- 基础状态优先级保留拖拽、睡眠、工作与待机，闲置超过 100 秒后小憩，鼠标靠近角色后唤醒
- 浏览器单视口边界避开房间底栏，个人形象与开关保存在本机，手机或窄屏不渲染桌宠
- 新建房间的桌宠总开关及个人显示开关默认关闭，已保存的明确开关值保留，房主开启总开关后成员可按需开启个人桌宠
- 番茄钟为房间内 25 分钟听歌专注提醒，未移植上游宿主专注间隔与所有统计功能
- 未移植原桌面程序的多屏、多宠物碰撞、宿主 API、系统托盘、开机启动、余额查询、声音资源及动作收藏置顶
- 原版程序的全部功能并非逐项移植，房间扩展交互不属于上游原版动作逻辑

## 可复现提取

将固定提交的源码保存到同一临时目录，文件名对应提取脚本中的 read / take 参数
原站 web/index.html 与 web/assets/chars 下的缩略图放在该目录的 reference-web 子目录，保留内部相对路径
在 client 目录执行以下命令，生成配置、原版物理函数和源码哈希清单

```powershell
node 'scripts/sync-desk-pet-upstream.mjs' 'C:\Users\sjb__\AppData\Local\Temp\openmusic-pet-source'
```

脚本通过 TypeScript AST 读取字面量和提取原函数，不执行下载的上游脚本
角色素材许可与署名见 client/public/desk-pet/SOURCES.md，程序 MIT 许可不替代角色的非商业授权
