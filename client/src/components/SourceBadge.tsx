import type { MusicSource } from '../types';
import { getSourceShortLabel } from '../lib/sourceLabels';

interface Props {
  source?: MusicSource;
  className?: string;
  /** colored / muted 统一使用与外部音质栏一致的平台色文字和边框 */
  variant?: 'colored' | 'muted';
}

const SOURCE_STYLES: Record<MusicSource, string> = {
  netease: 'text-[#ec4141]/80',
  tencent: 'text-[#31c27c]/80',
  kugou: 'text-[#2688ee]/80',
  qishui: 'text-[#f5c542]/85',
};

export default function SourceBadge({ source = 'netease', className = '' }: Props) {
  const sourceStyle = SOURCE_STYLES[source] || SOURCE_STYLES.netease;

  return (
    <span
      className={`inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-md border border-current bg-transparent px-1.5 text-[10px] font-medium leading-none tracking-tight flex-shrink-0 select-none ${sourceStyle} ${className}`}
    >
      {getSourceShortLabel(source)}
    </span>
  );
}
