import { Crown, Lock, ShieldCheck } from 'lucide-react';
import Tooltip from './Tooltip';

export default function RoomCardBadges({ isOwner, isAdmin, hasPassword, hardLocked }: {
  isOwner?: boolean; isAdmin?: boolean; hasPassword?: boolean; hardLocked: boolean;
}) {
  if (!isOwner && !isAdmin && (!hasPassword || hardLocked)) return null;
  return <span className="inline-flex shrink-0 items-center gap-1.5 self-start pt-1" aria-label="房间标识">
    {(isOwner || isAdmin) && <Tooltip content={isOwner ? '房主' : '管理员'}><span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/35 text-amber-300" aria-label={isOwner ? '房主' : '管理员'}>
      {isOwner ? <Crown className="h-4 w-4" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4 text-sky-300" aria-hidden="true" />}
    </span></Tooltip>}
    {hasPassword && !hardLocked && <Tooltip content="需要房间密码"><span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/10 text-amber-400" aria-label="需要密码"><Lock className="h-3.5 w-3.5" aria-hidden="true" /></span></Tooltip>}
  </span>;
}
