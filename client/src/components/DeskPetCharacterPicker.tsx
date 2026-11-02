import { DESK_PET_CHARACTERS } from '../lib/deskPetCharacters';
import { useDeskPetStore } from '../stores/deskPetStore';
import DeskPetAppearance from './DeskPetAppearance';
import './RoomAiDesktopPet.css';

export default function DeskPetCharacterPicker() {
  const character = useDeskPetStore((state) => state.character);
  const updatePref = useDeskPetStore((state) => state.updatePref);
  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-sm font-medium text-white">桌宠原版形象</p>
        <p className="mt-1 text-xs leading-relaxed text-netease-muted">
          来自 dafeiyu-pet / dsh-pet 的内置素材，选择立即生效并保存在本机，只影响你自己的桌宠
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="选择我的桌宠形象">
        {DESK_PET_CHARACTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={character === option.id}
            aria-label={`选择${option.label}`}
            onClick={() => updatePref('character', option.id)}
            className={`relative overflow-hidden rounded-xl border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-netease-red ${
              character === option.id
                ? 'border-netease-red/70 bg-netease-red/10'
                : 'border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/5'
            }`}
          >
            <div className="desk-pet-character-preview" aria-hidden="true">
              {option.id === 'v1' ? (
                <div className="desk-pet-character-preview__original"><DeskPetAppearance character="v1" preview /></div>
              ) : (
                <img src={option.previewSrc} alt="" loading="lazy" decoding="async" draggable={false} />
              )}
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium text-white">{option.label}</span>
              {character === option.id && <span className="text-[10px] text-netease-red">已选</span>}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-netease-muted">{option.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
