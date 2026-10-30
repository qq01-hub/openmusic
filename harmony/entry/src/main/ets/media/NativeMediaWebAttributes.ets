import { deviceInfo } from '@kit.BasicServicesKit';

export class NativeMediaWebAttributes implements AttributeModifier<WebAttribute> {
  applyNormalAttribute(instance: WebAttribute): void {
    // 新版 ArkWeb 默认也会创建媒体会话，避免与本应用的 AVSession 重复
    if (deviceInfo.sdkApiVersion >= 18) instance.enableWebAVSession(false);
  }
}
