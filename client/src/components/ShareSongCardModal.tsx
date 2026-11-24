import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ChatSongCard } from '../types';
import Modal from './Modal';
import ChatMusicCard from './ChatMusicCard';
import { sanitizeIncomingChatSongCard } from '../lib/chatAi';

interface Props {
  open: boolean;
  song: ChatSongCard | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}

/**
 * 分享音乐卡片确认弹窗：展示与聊天中一致（但不可播放）的卡片，
 * 并可随卡片捎带一条文字消息。
 */
export default function ShareSongCardModal({
  open,
  song,
  loading = false,
  onCancel,
  onConfirm,
}: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const safeSong = song ? sanitizeIncomingChatSongCard(song) : null;

  useEffect(() => {
    if (open) {
      setText('');
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open]);

  if (!open || !safeSong) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    onConfirm(text.trim().slice(0, 200));
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      zIndex={120}
      panelClassName="room-feature-dialog relative w-full max-w-sm animate-fade-in rounded-2xl border border-white/10 p-5 shadow-2xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-white">分享到聊天</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex justify-center">
        <ChatMusicCard song={safeSong} messageId="preview" preview />
      </div>

      <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          placeholder="说点什么（可留空）"
          className="w-full rounded-xl border border-netease-border bg-netease-card/60 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-netease-red/60 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/85 disabled:opacity-50"
          >
            {loading ? '发送中…' : '发送'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
