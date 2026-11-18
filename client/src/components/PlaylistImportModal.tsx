import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, ChevronLeft, Clock, Trash2 } from 'lucide-react';
import type { PlaylistPlatform } from '../api/music/playlist';
import {
  readPlaylistImportHistory,
  removePlaylistImportHistoryItem,
  type PlaylistImportHistoryItem,
} from '../lib/playlistImportHistory';
import Tooltip from './Tooltip';
import {
  immersiveGlassScrim,
  immersiveGlassModal,
  immersiveGlassInset,
  immersiveGlassInput,
} from '../lib/immersiveGlass';

export { rememberPlaylistImportHistory } from '../lib/playlistImportHistory';

const HINTS: Record<PlaylistPlatform, string> = {
  netease: '粘贴歌单分享文案或链接到下方。',
  kugou: '粘贴酷狗歌单分享链接到下方。',
  qq: '请在 QQ 音乐打开歌单 → 分享到「QQ」或「我的电脑」，再把链接粘贴到下方。链接必须带 id= 参数才可解析。',
  qishui: '粘贴汽水歌单 ID 或分享链接到下方。',
};

const QQ_EXAMPLE_LINK =
  'https://i2.y.qq.com/n3/other/pages/details/playlist.html?platform=11&appshare=android_qq&appversion=20020008&id=9211556467&ADTAG=qfshare';

const PLATFORM_LABELS: Record<PlaylistPlatform, string> = {
  netease: '网易',
  kugou: '酷狗',
  qq: 'QQ',
  qishui: '汽水',
};

const TITLES: Record<PlaylistPlatform, string> = {
  netease: '导入网易歌单',
  kugou: '导入酷狗歌单',
  qq: '导入 QQ 歌单',
  qishui: '导入汽水歌单',
};

type HistoryItem = PlaylistImportHistoryItem;

interface Props {
  open: boolean;
  loading?: boolean;
  qqImportEnabled?: boolean;
  immersive?: boolean;
  onClose: () => void;
  onImport: (platform: PlaylistPlatform, input: string) => void;
}

export default function PlaylistImportModal({
  open,
  loading = false,
  qqImportEnabled = true,
  immersive = false,
  onClose,
  onImport,
}: Props) {
  const [platform, setPlatform] = useState<PlaylistPlatform | null>(null);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(() => readPlaylistImportHistory());

  useEffect(() => {
    if (open) setHistory(readPlaylistImportHistory());
    if (!open) {
      setPlatform(null);
      setInput('');
    }
  }, [open]);

  const availablePlatforms = useMemo(() => ['netease', 'qq', 'kugou', 'qishui'].filter((item) => item !== 'qq' || qqImportEnabled) as PlaylistPlatform[], [qqImportEnabled]);
  const visibleHistory = useMemo(() => history.filter((item) => availablePlatforms.includes(item.platform)), [history, availablePlatforms]);

  if (!open) return null;

  const scrimClass = immersive ? immersiveGlassScrim : 'bg-[#08090c] backdrop-blur-sm';
  const panelClass = immersive
    ? `${immersiveGlassModal} w-full max-w-md rounded-[22px] p-5 sm:p-6`
    : 'glass w-full max-w-md rounded-2xl border border-white/10 shadow-2xl p-5 sm:p-6';
  const platformBtnClass = immersive
    ? `w-full rounded-xl px-4 py-3 text-sm text-white text-left transition-colors ${immersiveGlassInset}`
    : 'w-full rounded-xl border border-white/10 bg-netease-card/80 px-4 py-3 text-sm text-white text-left hover:border-netease-red/40 hover:bg-white/5 transition-colors';
  const historyRowClass = immersive
    ? `group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors ${immersiveGlassInset}`
    : 'group flex items-center gap-2 rounded-xl bg-white/[0.03] px-2.5 py-2 hover:bg-white/[0.06]';
  const inputClass = immersive
    ? `w-full resize-none rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/35 transition-colors disabled:opacity-50 ${immersiveGlassInput}`
    : 'w-full resize-none rounded-xl border border-netease-border bg-netease-card/80 px-3 py-2.5 text-sm text-white placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 transition-colors disabled:opacity-50';

  const canSubmit = input.trim().length > 0 && !loading;

  const submitImport = () => {
    if (!platform || !canSubmit) return;
    onImport(platform, input.trim());
  };

  const importFromHistory = (item: HistoryItem) => {
    if (loading) return;
    onImport(item.platform, item.playlistId);
  };

  const removeHistory = (id: string) => {
    setHistory(removePlaylistImportHistoryItem(id));
  };

  if (!platform) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <button
          type="button"
          className={`absolute inset-0 ${scrimClass}`}
          onClick={onClose}
          aria-label="关闭"
        />
        <div className={`relative animate-fade-in ${panelClass}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-white">导入歌单</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs sm:text-sm text-white/60 mb-4">选择歌单来源平台</p>

          <div className="flex flex-col gap-2">
            {availablePlatforms.map((item) => (
              <Tooltip key={item} content={item === 'qq' && !qqImportEnabled ? 'QQ 歌单导入暂不可用' : undefined}>
                <button
                  type="button"
                  onClick={() => setPlatform(item)}
                  disabled={item === 'qq' && !qqImportEnabled}
                  className={`${platformBtnClass} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {PLATFORM_LABELS[item]}
                </button>
              </Tooltip>
            ))}
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-white/60">
              <Clock className="h-3.5 w-3.5" />
              历史导入歌单
            </div>
            {visibleHistory.length === 0 ? (
              <p className={`rounded-xl px-3 py-3 text-xs text-netease-muted ${immersive ? immersiveGlassInset : 'bg-white/[0.03]'}`}>暂无历史记录</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {visibleHistory.map((item) => (
                  <div key={item.id} className={historyRowClass}>
                    <Tooltip content="直接解析该歌单">
                      <button
                        type="button"
                        onClick={() => importFromHistory(item)}
                        disabled={loading}
                        className="min-w-0 flex-1 text-left disabled:opacity-50"
                      >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-white/55">{PLATFORM_LABELS[item.platform]}</span>
                        <span className="min-w-0 truncate text-xs text-white/85">{item.name}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-netease-muted">ID：{item.playlistId}</p>
                    </button>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => removeHistory(item.id)}
                      disabled={loading}
                      className="rounded-lg p-1.5 text-white/35 opacity-100 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label="删除历史"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        className={`absolute inset-0 ${scrimClass}`}
        onClick={onClose}
        aria-label="关闭"
      />
      <div className={`relative animate-fade-in ${panelClass}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setPlatform(null)}
              disabled={loading}
              className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              aria-label="返回选择平台"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-base sm:text-lg font-semibold text-white truncate">{TITLES[platform]}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-white/60 leading-relaxed mb-4">
          {HINTS[platform]}
        </p>

        {platform === 'qq' && (
          <div className={`mb-4 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed text-white/55 ${immersive ? immersiveGlassInset : 'bg-white/[0.03] border border-white/8'}`}>
            <p className="text-white/70">可用示例（其中 <span className="text-white/90">id=</span> 必须有）：</p>
            <p className="mt-1 break-all font-mono text-white/45">{QQ_EXAMPLE_LINK}</p>
          </div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={platform === 'netease'
            ? '粘贴分享链接、完整分享文案或歌单 ID...'
            : platform === 'qishui'
                ? '粘贴汽水歌单分享链接或歌单 ID...'
                : platform === 'kugou'
                  ? '粘贴酷狗歌单分享链接或歌单 ID...'
                  : '粘贴 QQ 分享链接（需含 id=）或歌单 ID...'}
          rows={4}
          disabled={loading}
          className={inputClass}
        />

        <div className="flex gap-2 justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm text-white/70 hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submitImport}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-xl text-sm bg-netease-red text-white hover:bg-netease-red/85 transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            解析歌单
          </button>
        </div>
      </div>
    </div>
  );
}
