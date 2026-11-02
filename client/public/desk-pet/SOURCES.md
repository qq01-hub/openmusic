# 大肥鱼桌宠素材

角色素材直接取自 shenliuyu18/dafeiyu-pet 的 assets 目录
原版动画的原始项目为 PC2005-cloud/dsh-pet，程序代码采用 MIT 许可
MIT 许可全文见 LICENSE-dsh-pet.txt
原始透明 WebM 未重新绘制或重新编码，106 个动作保留上游中文名称，文件统一存放于 anims/ 目录
发布文件名采用 anim- 加中文名称各 Unicode 码点的小写十六进制，以连字符分隔，避免 ZIP 解压工具误读中文名称，视频内容不变
idle.png 为待机动画中的透明画面，用于加载和解码失败时显示
shoushou.woff2 为上游 assets/fonts/上首软糖体.woff2 原文件，许可同上游素材说明

- 来源 https://github.com/shenliuyu18/dafeiyu-pet
- 原始项目 https://github.com/PC2005-cloud/dsh-pet

## 内置形象

- v1 使用上述透明视频，原始项目为 PC2005-cloud/dsh-pet
- v2～v5 原文件来自 assets/fish2～fish5，原始项目为 louke6572/dsh-whale-widget-plus，许可见 LICENSE-dsh-whale-widget-plus.txt
- v6 原文件来自 assets/fish6，原始项目为 MeteorNOX/DeepSeek-Balance-Whale-Widget，许可见 LICENSE-DeepSeek-Balance-Whale-Widget.txt
- GPT 娘使用 assets/gpt/spritesheet.webp 原图，来源 weit0529/gpt-pet，许可与角色署名见 LICENSE-gpt-pet.txt
- GPT 娘的图集布局与逐帧时长参考 dafeiyu-pet 的 renderer/pet.js
- 未引入档案馆图片，未重新绘制角色，未裁切、拉伸或重新编码下载的原素材
- 设置选择器的 previews/v2.webp～v6.webp、gpt.webp 直接复制自同一固定提交的 web/assets/chars，对应 web/index.html 的形象列表
- v1 按用户偏好保留 idle.png 待机画面缩略图，v2～v6 与 GPT 娘使用原站对应缩略图

## 源码版本与移植

- dafeiyu-pet 固定提交 4d9aadf05af87d94ecadc05bd206fc94cb6eb639
- dsh-pet 固定提交 09aa6c3beae269e3ab0738a1d4c84066e5c03a23
- upstream-sources.json 记录参与提取的源码 SHA256
- CHARS / ANIM / SPRITE / SPRITE_MAP / ACTIONS / WHISPERS / NO_MIRROR 从上游 renderer/pet.js 的字面量配置直接提取
- 单视口弹簧、释放速度、弹射与碰撞算法从 dsh-pet 的 src/shared/physics 提取
- 复现工具为 client/scripts/sync-desk-pet-upstream.mjs，移植范围与差异见 docs/desk-pet-source-port.md

## 角色素材授权说明

MIT 程序许可不替代角色形象授权
PC2005-cloud/dsh-pet 当前 README 单独注明动画、提示词与源视频允许开源使用，禁止商用
该 README 将大肥鱼形象标注为 CC BY-NC-SA 4.0，形象原型为 @上善无形 的「溟月」，DeepSeek 女仆鲸鱼娘设计为 @ZipZipPipe 的社区二创，并非 DeepSeek 官方形象
需保留署名，遵守非商业和相同方式共享要求，不能将上游程序的 MIT 许可解释为角色素材可商用

- 原始说明 https://github.com/PC2005-cloud/dsh-pet#readme
- 形象原型 https://space.bilibili.com/4456176
- 社区二创 https://space.bilibili.com/4168597
- 授权声明 https://www.bilibili.com/opus/1247156596114456581
- CC BY-NC-SA 4.0 https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans
