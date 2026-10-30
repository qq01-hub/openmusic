import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { releaseHarmonyMedia, setHarmonyMediaForeground } from '../media/HarmonyMediaService';

export default class EntryAbility extends UIAbility {
  onForeground(): void {
    setHarmonyMediaForeground(true);
  }

  onBackground(): void {
    // 后台不销毁 Web 或 AVSession，由音频状态管理长时任务
    setHarmonyMediaForeground(false);
  }

  onWindowStageDestroy(): void {
    releaseHarmonyMedia();
  }

  onDestroy(): void {
    releaseHarmonyMedia();
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index').catch(() => {
      // 不记录页面 URL、OAuth 参数或登录凭据
      hilog.error(0x0000, 'OpenMusic', 'Shell content could not be loaded');
    });
  }
}
