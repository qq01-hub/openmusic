/** 歌名旁实际音质标：网易红 / QQ 绿 / 汽水黄 / 酷狗蓝，简洁短标 */

import type { MusicSource } from '../types';
import Tooltip from './Tooltip';

interface Props {
  label?: string | null;
  source?: MusicSource | null;
  className?: string;
}

type QualityTier = 'standard' | 'high' | 'lossless' | 'hires' | 'vip';

function resolveTier(label: string): QualityTier {
  const t = label.toLowerCase();
  if (/母带|master|jymaster|杜比|dolby|全景|环绕|atmos|sky|空间|臻音|jyeffect/.test(t)) {
    return 'vip';
  }
  if (/高解析|hi-?res|hires/.test(t)) return 'hires';
  if (/无损|lossless|flac|sq/.test(t)) return 'lossless';
  if (/极高|较高|高品|hq|exhigh|higher|320/.test(t)) return 'high';
  return 'standard';
}

/** 按平台短标：SQ 是QQ术语，网易用「无损」 */
function shortenLabel(label: string, source?: MusicSource | null): string {
  if (source === 'tencent') {
    const tencentMap: Record<string, string> = {
      标准品质: '标准',
      HQ高品质: 'HQ',
      SQ无损品质: 'SQ',
      臻品全景声: '全景声',
      臻品母带: '母带',
    };
    return tencentMap[label] || label;
  }

  if (source === 'kugou') {
    return label;
  }

  if (source === 'qishui') {
    const qishuiMap: Record<string, string> = {
      standard: '标准',
      exhigh: '极高',
      studio: '录音室',
      atmos: '全景声',
      lossless: '无损',
      标准: '标准',
      高品: '极高',
      高品质: '极高',
      录音室音质: '录音室',
      全景声: '全景声',
      无损: '无损',
    };
    return qishuiMap[label.toLowerCase()] || qishuiMap[label] || label;
  }

  const neteaseMap: Record<string, string> = {
    标准: '标准',
    较高: '较高',
    极高: '极高',
    无损: '无损',
    高解析度无损: 'Hi-Res',
    高清臻音: '臻音',
    沉浸环绕声: '环绕声',
    超清母带: '母带',
    杜比全景声: '杜比全景声',
  };
  return neteaseMap[label] || label;
}

const NETEASE_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-[#ec4141]/35 text-[#ec4141]/70',
  high: 'border-[#ec4141]/50 text-[#ec4141]/85',
  lossless: 'border-[#ec4141]/70 text-[#ec4141]',
  hires: 'border-[#ec4141]/85 text-[#ec4141]',
  vip: 'border-[#ec4141] text-[#ec4141]',
};

const TENCENT_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-[#31c27c]/35 text-[#31c27c]/70',
  high: 'border-[#31c27c]/50 text-[#31c27c]/85',
  lossless: 'border-[#31c27c]/70 text-[#31c27c]',
  hires: 'border-[#31c27c]/85 text-[#31c27c]',
  vip: 'border-[#31c27c] text-[#31c27c]',
};

/** 酷狗：统一蓝边；无音质返回时按标准档展示 */
const KUGOU_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-[#2688ee]/45 text-[#2688ee]/80',
  high: 'border-[#2688ee]/60 text-[#2688ee]/90',
  lossless: 'border-[#2688ee]/75 text-[#2688ee]',
  hires: 'border-[#2688ee]/85 text-[#2688ee]',
  vip: 'border-[#2688ee] text-[#2688ee]',
};

const QISHUI_TIER_CLASS: Record<QualityTier, string> = {
  standard: 'border-[#f5c542]/35 text-[#f5c542]/70',
  high: 'border-[#f5c542]/50 text-[#f5c542]/85',
  lossless: 'border-[#f5c542]/70 text-[#f5c542]',
  hires: 'border-[#f5c542]/85 text-[#f5c542]',
  vip: 'border-[#f5c542] text-[#f5c542]',
};

function tierClassForSource(source: MusicSource | null | undefined, tier: QualityTier): string {
  if (source === 'tencent') return TENCENT_TIER_CLASS[tier];
  if (source === 'qishui') return QISHUI_TIER_CLASS[tier];
  if (source === 'kugou') return KUGOU_TIER_CLASS[tier];
  return NETEASE_TIER_CLASS[tier];
}

export default function PlaybackQualityTag({ label, source, className = '' }: Props) {
  // 酷狗上游不回传音质，默认按「标准」展示
  const raw = label?.trim() || (source === 'kugou' ? '标准' : '');
  if (!raw) return null;

  const short = shortenLabel(raw, source);
  const tier = source === 'kugou' && !label?.trim() ? 'standard' : resolveTier(raw);
  const tierClass = tierClassForSource(source, tier);

  return (
    <Tooltip content={`实际音质：${raw}`}>
      <span
        className={
          `inline-flex flex-shrink-0 items-center rounded-[2px] border px-[3px] py-px ` +
          `text-[9px] font-medium leading-[1.2] tracking-wide ` +
          `${tierClass} ${className}`
        }
      >
        {short}
      </span>
    </Tooltip>
  );
}
