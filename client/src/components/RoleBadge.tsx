import { Crown, Shield } from 'lucide-react';
import { usePureModeStore } from '../stores/pureModeStore';
import Tooltip from './Tooltip';

type Role = 'owner' | 'admin';

interface Props {
  role: Role;
  /** full：完整角标；icon：仅皇冠/盾牌（有贵宾标时附在昵称旁） */
  variant?: 'full' | 'icon';
  className?: string;
}

export default function RoleBadge({ role, variant = 'full', className = '' }: Props) {
  const plain = usePureModeStore((s) => s.enabled);
  const label = role === 'owner' ? '房主' : '管理';
  const isOwner = role === 'owner';

  if (variant === 'icon') {
    if (plain) {
      return (
        <Tooltip content={label} side="bottom">
          <span
            className={`inline-flex flex-shrink-0 text-[10px] leading-4 text-netease-muted/65 ${className}`}
            aria-label={label}
          >
            {isOwner ? '主' : '管'}
          </span>
        </Tooltip>
      );
    }

    const icon = isOwner ? (
      <Crown
        className="h-3.5 w-3.5 flex-shrink-0 text-amber-200 drop-shadow-[0_0_5px_rgba(251,191,36,0.85)]"
        strokeWidth={2.25}
        fill="currentColor"
        fillOpacity={0.35}
      />
    ) : (
      <Shield
        className="h-3.5 w-3.5 flex-shrink-0 text-sky-300 drop-shadow-[0_0_4px_rgba(56,189,248,0.55)]"
        strokeWidth={2.25}
        fill="currentColor"
        fillOpacity={0.3}
      />
    );

    return (
      <Tooltip content={label} side="bottom">
        <span
          className={`inline-flex flex-shrink-0 items-center justify-center ${className}`}
          aria-label={label}
        >
          {icon}
        </span>
      </Tooltip>
    );
  }

  if (plain) {
    return (
      <span className={`inline-flex flex-shrink-0 text-[10px] leading-4 text-netease-muted/65 ${className}`}>
        {label}
      </span>
    );
  }

  if (isOwner) {
    return (
      <span
        className={`role-badge role-badge-owner inline-flex flex-shrink-0 items-center rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-0.5 text-[10px] leading-4 ${className}`}
      >
        <span className="role-badge-content">
          <Crown
            className="h-3 w-3 flex-shrink-0 text-amber-200 drop-shadow-[0_0_5px_rgba(251,191,36,0.85)]"
            strokeWidth={2.25}
            fill="currentColor"
            fillOpacity={0.35}
          />
          房主
        </span>
      </span>
    );
  }

  return (
    <span
      className={`role-badge role-badge-admin inline-flex flex-shrink-0 items-center rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 text-[10px] leading-4 ${className}`}
    >
      <span className="role-badge-content">
        <Shield
          className="h-3 w-3 flex-shrink-0 text-sky-300 drop-shadow-[0_0_4px_rgba(56,189,248,0.55)]"
          strokeWidth={2.25}
          fill="currentColor"
          fillOpacity={0.3}
        />
        管理
      </span>
    </span>
  );
}
