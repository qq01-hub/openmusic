import { useCallback, useEffect, useState } from 'react';
import { DoorOpen, RefreshCw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listAccountRooms } from '../api/accountRooms';
import type { AccountRoomSummary } from '../types';
import { fetchAccountSession } from '../lib/accountAuth';
import { headerPillCls } from '../lib/homeHeaderActions';
import Modal from './Modal';
import MusicLoading from './MusicLoading';

export default function MyRoomsAccess() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rooms, setRooms] = useState<AccountRoomSummary[]>([]);
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAccountSession().then((account) => { if (active) setAuthenticated(Boolean(account)); }).catch(() => undefined);
    const refresh = () => { void fetchAccountSession().then((account) => { if (active) setAuthenticated(Boolean(account)); }).catch(() => undefined); };
    window.addEventListener('openmusic:account-session-changed', refresh);
    return () => { active = false; window.removeEventListener('openmusic:account-session-changed', refresh); };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRooms(await listAccountRooms());
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取我的房间失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const show = () => {
    setOpen(true);
    void load();
  };

  if (!authenticated) return null;
  return (
    <>
      <button type="button" onClick={show} className={`${headerPillCls} hidden`}>
        <DoorOpen className="h-4 w-4" />
        <span className="hidden sm:inline">我的房间</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        panelClassName="room-feature-dialog relative w-full max-w-lg rounded-3xl border border-white/10 p-5 shadow-2xl"
      >
        <section role="dialog" aria-modal="true" aria-label="我的房间">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">我的房间</h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="关闭"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-4 space-y-2">
            {loading ? <MusicLoading label="正在加载我的房间" compact /> : null}
            {!loading && error ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-100">
                <p>{error}</p>
                <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 text-white"><RefreshCw className="h-4 w-4" />重试</button>
              </div>
            ) : null}
            {!loading && !error && rooms.length === 0 ? <p className="py-10 text-center text-sm text-white/45">还没有绑定到账户的房间</p> : null}
            {!loading && !error && rooms.map((room) => (
              <button key={room.id} type="button" onClick={() => navigate(`/room/${room.id}`)} className="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3 text-left transition hover:bg-white/[0.07]">
                <span><span className="block text-sm text-white">{room.name}</span><span className="mt-0.5 block text-xs text-white/40">{room.id} · {room.userCount} 人在线</span></span>
                <DoorOpen className="h-4 w-4 text-white/45" />
              </button>
            ))}
          </div>
        </section>
      </Modal>
    </>
  );
}
