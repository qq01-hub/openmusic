# OpenMusic Folia Stage

基于 Folia `77640a4c9861df04ce1197944ce57e0ad7f56d66` 的独立视觉舞台

来源与完整文件清单位于 `upstream/SOURCE.json`，上游许可证位于 `upstream/LICENSE`

本目录及 Folia 派生适配使用 AGPL-3.0，原仓库其他文件的许可证不因此被重新标记

构建执行 `npm ci --ignore-scripts` 后运行 `npm run build`，需要主项目提供房间时钟、歌词和频谱消息

本地修改集中在 `stage.tsx`、`useFoliaAssets.ts`、`stage.css`、`vite.config.mjs`，上游适配为 `beatFxSource.ts` 的来源类型、`beatFxLive.ts` 的媒体时钟输入类型、`drumHits.ts` 的外部节拍安装入口和 `binaryAssetStore.ts` 的文件句柄类型断言

`utils/foliaPortal.ts`、`CustomSelect` 及导航 hook、`Sheet`、设置 kit 的 `Tooltip`、`Popover`、`Menu` 与 `Tabs` 还适配了 Shadow DOM 内的弹层容器、事件路径和键盘焦点

Tempera 图片备份菜单的外部点击判断同样使用完整事件路径

`lyrics.ts` 统一普通 LRC 的时间精度、重复时间戳与 offset，普通歌词保持逐行时间，不按字数推算逐字时间

`Word.timingMode` 与 `graphemeTiming.ts` 保留普通歌词的整行显隐边界，`GlowWord` 挂载和更换词条时读取当前时间，暂停时切换主题也能立即显示主歌词

`frameRateLimiter.ts` 只调度舞台自身的绘制回调，Pixi 使用各自 ticker 的限帧，镜台使用独立 Canvas 时钟，不替换 OpenMusic 的全局动画函数，舞台卸载时清理待执行回调

与主站的接入、接口、限制及回滚说明见 `../../docs/FOLIA_IMMERSIVE.md`
