import type { MusicSource } from '../types';
import { getSourceShortLabel } from '../lib/sourceLabels';

interface Props {
  source?: MusicSource;
  className?: string;
  /** colored / muted 统一仅使用平台色边框 */
  variant?: 'colored' | 'muted';
}

const BORDER_STYLES: Record<MusicSource, string> = {
  netease: 'border-[#ec4141]/60',
  tencent: 'border-[#31c27c]/60',
  kugou: 'border-[#2688ee]/60',
  qishui: 'border-[#f5c542]/60',
};

export default function SourceBadge({ source = 'netease', className = '' }: Props) {
  const borderStyle = BORDER_STYLES[source] || BORDER_STYLES.netease;

  return (
    <span
      className={`inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-md border bg-transparent px-1.5 text-[10px] font-medium leading-none tracking-tight text-white/75 flex-shrink-0 select-none ${borderStyle} ${className}`}
    >
      {getSourceShortLabel(source)}
    </span>
  );
}
