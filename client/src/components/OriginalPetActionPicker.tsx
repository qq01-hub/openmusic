import { useMemo, useState } from 'react';
import {
  getDeskPetCharacter,
  getDeskPetPlayableActions,
  DESK_PET_VIDEO_GROUPS,
  type DeskPetCharacterId,
} from '../lib/deskPetCharacters';

export default function OriginalPetActionPicker({ character, onPlay }: {
  character: DeskPetCharacterId; onPlay: (action: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState('全部');
  const config = getDeskPetCharacter(character);

  const allActions = useMemo(() => getDeskPetPlayableActions(character), [character]);

  const groupNames = useMemo(
    () => (config.kind === 'video' ? ['全部', ...DESK_PET_VIDEO_GROUPS.map((g) => g.name)] : []),
    [config.kind],
  );

  const visibleActions = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    const baseList =
      config.kind === 'video' && activeGroup !== '全部'
        ? (DESK_PET_VIDEO_GROUPS.find((g) => g.name === activeGroup)?.list ?? []).map((name) => ({
            id: name,
            label: name,
          }))
        : allActions;
    if (!trimmed) return baseList;
    return baseList.filter(({ label }) => label.toLocaleLowerCase().includes(trimmed));
  }, [activeGroup, allActions, config.kind, query]);

  return (
    <div>
      <div className="mb-1.5 text-[13px] text-[var(--om-text-secondary)]">{config.label} · {allActions.length} 个原版动作</div>
      <input aria-label="搜索原版动作" value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索动作名称" className="mb-1.5 w-full rounded-md border border-[var(--om-border-strong)] bg-[var(--om-canvas)] px-2 py-1.5 text-[13px] text-[var(--om-text)] placeholder:text-[var(--om-text-secondary)] outline-none focus:border-netease-red/70 focus:ring-1 focus:ring-netease-red/30" />
      {groupNames.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {groupNames.map((groupName) => (
            <button
              key={groupName}
              type="button"
              onClick={() => setActiveGroup(groupName)}
              className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                activeGroup === groupName
                  ? 'bg-netease-red/15 text-[var(--om-accent-soft)] ring-1 ring-inset ring-netease-red/30'
                  : 'bg-[var(--om-surface-hover)] text-[var(--om-text-secondary)] hover:text-[var(--om-text)]'
              }`}
            >
              {groupName}
            </button>
          ))}
        </div>
      )}
      <div className="grid max-h-[min(220px,32vh)] grid-cols-2 gap-1 overflow-y-auto overscroll-contain">
        {visibleActions.map((action) => (
          <button key={action.id} type="button" onClick={() => onPlay(action.id)}
            className="whitespace-normal rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--om-text)] hover:bg-[var(--om-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-netease-red">
            {action.label}
          </button>
        ))}
        {!visibleActions.length && <div className="col-span-2 py-3 text-center text-[var(--om-text-secondary)]">没有匹配的动作</div>}
      </div>
    </div>
  );
}
