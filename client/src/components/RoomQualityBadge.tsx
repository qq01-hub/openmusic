import { AudioLines } from 'lucide-react';
import { resolveEffectiveAudioQuality, useUserQualityStore } from '../stores/userQualityStore';
import { useRoomStore } from '../stores/roomStore';
import { getQualityLabel } from '../api/music/quality';
import type { RoomAudioQuality } from '../types';
import Tooltip from './Tooltip';

interface Props {
  audioQuality?: RoomAudioQuality | null;
  className?: string;
  onClick?: () => void;
  compact?: boolean;
}

function shortenQualityLabel(label: string, source: 'netease' | 'tencent' | 'kugou' | 'qishui'): string {
  const map: Record<string, string> = {
    标准: '标准',
    标准品质: '标准',
    较高: '较高',
    极高: '极高',
    HQ高品质: 'HQ',
    无损: '无损',
    SQ无损品质: 'SQ',
    高清臻音: '臻音',
    沉浸环绕声: '环绕',
    超清母带: '母带',
    杜比全景声: 'Dolby',
    臻品全景声: '全景',
    臻品母带: '母带',
    高解析度无损: 'Hi-Res',
    全景声: '全景',
    母带: '母带',
  };
  return map[label] || getQualityLabel(label, source);
}

export default function RoomQualityBadge({ audioQuality, className = '', onClick, compact = false }: Props) {
  const roomQuality = useRoomStore((s) => s.room?.audioQuality);
  // 订阅本机音质，保证「我的音质」改完后左上角即时同步
  const userQuality = useUserQualityStore((s) => s.quality);
  const quality = resolveEffectiveAudioQuality(userQuality ?? audioQuality ?? roomQuality);

  const neteaseLabel = getQualityLabel(quality.netease, 'netease');
  const tencentLabel = getQualityLabel(quality.tencent, 'tencent');
  const kugouLabel = getQualityLabel(quality.kugou, 'kugou');
  const qishuiLabel = getQualityLabel(quality.qishui, 'qishui');
  const neteaseShort = shortenQualityLabel(neteaseLabel, 'netease');
  const tencentShort = shortenQualityLabel(tencentLabel, 'tencent');
  const kugouShort = shortenQualityLabel(kugouLabel, 'kugou');
  const qishuiShort = shortenQualityLabel(qishuiLabel, 'qishui');

  const content = (
    <>
      <AudioLines className="h-3 w-3 text-white/35" aria-hidden />
      <Tooltip content={`网易：${neteaseLabel}`}>
        <span className="inline-flex items-center gap-1">
          <span className="text-[#ec4141]/80">网易</span>
          <span className="text-white/75">{neteaseShort}</span>
        </span>
      </Tooltip>
      <span className="text-white/15" aria-hidden>/</span>
      <Tooltip content={`QQ：${tencentLabel}`}>
        <span className="inline-flex items-center gap-1">
          <span className="text-[#31c27c]/80">QQ</span>
          <span className="text-white/75">{tencentShort}</span>
        </span>
      </Tooltip>
      <span className="text-white/15" aria-hidden>/</span>
      <Tooltip content={`酷狗：${kugouLabel}`}>
        <span className="inline-flex items-center gap-1">
          <span className="text-[#2688ee]/80">酷狗</span>
          <span className="text-white/75">{kugouShort}</span>
        </span>
      </Tooltip>
      <span className="text-white/15" aria-hidden>/</span>
      <Tooltip content={`汽水：${qishuiLabel}`}>
        <span className="inline-flex items-center gap-1">
          <span className="text-[#f5c542]/85">汽水</span>
          <span className="text-white/75">{qishuiShort}</span>
        </span>
      </Tooltip>
    </>
  );

  const baseClass =
    `inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 ` +
    `bg-white/[0.04] px-1.5 text-[10px] font-medium leading-none tracking-wide text-netease-muted ` +
    className;

  if (!onClick) {
    return <div className={baseClass}>{content}</div>;
  }

  const button = (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClass} transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-white`}
      aria-label="设置我的音质"
    >
      {compact ? <><AudioLines className="h-3 w-3" aria-hidden /><span>音质</span></> : content}
    </button>
  );
  return compact ? (
    <Tooltip content={`网易：${neteaseLabel} / QQ：${tencentLabel} / 酷狗：${kugouLabel} / 汽水：${qishuiLabel}`}>
      {button}
    </Tooltip>
  ) : button;
}
