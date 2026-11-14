import { getFmModeLabel, getFmSourceLabel, normalizeFmMode, type FmSource } from '../api/music/fmMode';
import Tooltip from './Tooltip';

interface Props {
  fmMode?: string | null;
  fmSource?: FmSource | null;
  playlistRoamingCount?: number;
  clickable?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function RoomFmModeBadge({ fmMode, fmSource = 'netease', playlistRoamingCount = 0, clickable = false, onClick, className = '' }: Props) {
  const mode = normalizeFmMode(fmMode);
  const label = getFmModeLabel(mode);
  const isPlaylistRoaming = playlistRoamingCount > 0;

  return (
    <Tooltip content={isPlaylistRoaming ? `指定歌单漫游：${playlistRoamingCount} 个歌单` : (clickable ? '点击切换漫游平台和模式' : `私人漫游：${label}`)}>
      <button
        type={clickable ? 'button' : undefined}
        onClick={clickable ? onClick : undefined}
        disabled={!clickable}
        className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 bg-white/[0.04] px-2 text-[10px] font-medium leading-none text-netease-muted transition-colors disabled:opacity-100 ${
          clickable ? 'hover:border-white/20 hover:bg-white/[0.07] hover:text-white' : 'cursor-default'
        } ${className}`}
      >
        <span className="shrink-0 font-medium text-[#ec4141]">漫游</span>
        <span className="min-w-0 truncate text-white/75">{isPlaylistRoaming ? '指定歌单' : `${label} / ${getFmSourceLabel(fmSource)}`}</span>
      </button>
    </Tooltip>
  );
}
