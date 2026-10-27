import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import VisualizerRenderer from './upstream/src/components/visualizer/VisualizerRenderer';
import { VISUALIZER_REGISTRY, getVisualizerRegistryEntry } from './upstream/src/components/visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY, getVisualizerBackgroundRegistryEntry } from './upstream/src/components/visualizer/backgrounds/registry';
import { backgroundTuningActions, backgroundTuningConfig, collectVisualizerTunings, getVisualizerTuning } from './upstream/src/components/visualizer/tuningRegistry';
import { useVisualizerSettingsStore } from './upstream/src/stores/useVisualizerSettingsStore';
import { useFoliaAssets } from './useFoliaAssets';
import { installGlobalVisualizerFrameRateLimiter, restoreGlobalVisualizerFrameRateLimiter } from './upstream/src/utils/frameRateLimiter';
import { beginBeatFxTrack, setBeatFxEvents, setBeatFxLiveEffects, tickBeatFx } from './upstream/src/services/beatFx/beatFxLive';
import { isBeatEffectLive, resolveBeatEffectSetting, offeredBeatEffects, type BeatEffectDef } from './upstream/src/services/beatFx/beatEffects';
import { installOpenMusicDrumHits } from './upstream/src/services/analysis/drumHits';
import type { BeatFxEvent } from './upstream/src/services/beatFx/clock';
import { SheetLayerContext } from './upstream/src/components/shared/Sheet';
import { SettingsKitThemeContext, settingsTokens } from './upstream/src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from './upstream/src/components/modal/settings/kit/motion';
import { Row, Select, Slider, Toggle } from './upstream/src/components/modal/settings/kit';
import { X } from 'lucide-react';
import { getFoliaPortalRoot, setFoliaPortalRoot } from './upstream/src/utils/foliaPortal';
import { parseFoliaLyrics } from './lyrics';
import i18n from './upstream/src/i18n/config';
import type { Line, Theme, SmartBeatMode, VisualizerFrameRate } from './upstream/src/types';
import './upstream/src/index.css';
import './stage.css';

void i18n.changeLanguage('zh-CN');
const initialTheme: Theme = { name: 'OpenMusic', backgroundColor: '#12141c', primaryColor: '#f4f2ea', accentColor: '#b7caff', secondaryColor: '#c9c2d6', fontStyle: 'sans', animationIntensity: 'normal' };
const parentOrigin = location.origin;
const send = (type: string, data = {}) => window.postMessage({ type, ...data }, parentOrigin);
const readStoredNumber = (key: string, fallback: number, min: number, max: number): number => {
  const stored = localStorage.getItem(key);
  const value = stored?.trim() ? Number(stored) : NaN;
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

function Stage() {
  const storedSettings = useVisualizerSettingsStore();
  const settings = storedSettings as typeof storedSettings & Record<string, unknown>;
  const assets = useFoliaAssets();
  const { t } = useTranslation();
  const [song, setSong] = useState({ key: '', name: '', artist: '', cover: '', duration: 0 });
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState('等待播放');
  const [customPalette, setCustomPalette] = useState<Theme>(() => {
    try { return { ...initialTheme, ...JSON.parse(localStorage.getItem('openmusic:folia-theme') || '{}') }; }
    catch { return initialTheme; }
  });
  const [customTheme, setCustomTheme] = useState(() => localStorage.getItem('openmusic:folia-custom-theme') === 'on');
  const [autoTheme, setAutoTheme] = useState(initialTheme);
  const theme = useMemo<Theme>(() => ({
    ...(customTheme ? customPalette : autoTheme),
    fontStyle: customPalette.fontStyle,
    fontWeight: customPalette.fontWeight,
    animationIntensity: customPalette.animationIntensity,
  }), [customTheme, customPalette, autoTheme]);
  const setTheme = (patch: Partial<Theme>, customColors = false) => {
    setCustomPalette(previous => ({ ...previous, ...patch }));
    if (customColors) { setCustomTheme(true); localStorage.setItem('openmusic:folia-custom-theme', 'on'); }
  };
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('lyrics');
  const [index, setIndex] = useState(-1);
  const [paused, setPaused] = useState(true);
  const [scale, setScale] = useState(() => readStoredNumber('openmusic:folia-scale', 1, 0.5, 2));
  const [translation, setTranslation] = useState(() => localStorage.getItem('openmusic:folia-translation') !== 'off');
  const [coverColorBg, setCoverColorBg] = useState(() => localStorage.getItem('openmusic:folia-cover-colors') === 'on');
  const [offset, setOffset] = useState(() => readStoredNumber('openmusic:folia-offset', 0, -5, 5));
  const [staticMode, setStaticMode] = useState(() => localStorage.getItem('openmusic:folia-static') === 'on' || (localStorage.getItem('openmusic:folia-static') !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches));
  const currentTime = useMotionValue(0);
  const audioPower = useMotionValue(0);
  const bass = useMotionValue(0), lowMid = useMotionValue(0), mid = useMotionValue(0), vocal = useMotionValue(0), treble = useMotionValue(0);
  const spectrum = useMotionValue(new Uint8Array(512));
  const bands = useMemo(() => ({ bass, lowMid, mid, vocal, treble, spectrum }), []);
  const state = useRef({ key: '', lines: [] as Line[], index: -1, offset: 0, panel: false });
  state.current.offset = offset;
  state.current.panel = panel;
  useEffect(() => { localStorage.setItem('openmusic:folia-theme', JSON.stringify(customPalette)); }, [customPalette]);
  useEffect(() => { send('openmusic:folia-analysis', { enabled: settings.smartBeat.mode === 'on' }); }, [settings.smartBeat.mode]);
  useEffect(() => { send('openmusic:folia-panel', { open: panel }); }, [panel]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== parentOrigin) return;
      const data = event.data;
      if (data?.type === 'openmusic:folia-song') {
        state.current.key = data.song.key;
        state.current.lines = [];
        state.current.index = -1;
        beginBeatFxTrack(data.song.key);
        const preferences = useVisualizerSettingsStore.getState();
        if (preferences.randomVisualizerModePerSong && data.song.key && preferences.randomVisualizerModes.length) {
          const selected = preferences.randomVisualizerModes[Math.floor(Math.random() * preferences.randomVisualizerModes.length)];
          preferences.handleSetVisualizerMode(selected, { notify: false, preserveRandom: true });
        }
        setSong(data.song); setLines([]); setIndex(-1); setStatus(data.song.key ? '正在获取歌词' : '等待播放');
      } else if (data?.type === 'openmusic:folia-cover' && data.key === state.current.key) setSong(previous => ({ ...previous, cover: data.cover }));
      else if (data?.type === 'openmusic:folia-lyrics' && data.key === state.current.key) {
        const lyrics = data.lyrics;
        try {
          const parsed = parseFoliaLyrics(lyrics);
          state.current.lines = parsed.lines;
          setLines(parsed.lines);
          setStatus(parsed.lines.length ? (parsed.isWordByWord ? '逐字歌词' : '逐行歌词') : '暂无歌词');
        } catch { state.current.lines = []; setLines([]); setStatus('歌词解析失败'); }
      } else if (data?.type === 'openmusic:folia-clock' && data.key === state.current.key && Number.isFinite(data.time)) {
        const time = Math.max(0, data.time + state.current.offset);
        currentTime.set(time); setPaused(!data.playing);
        tickBeatFx({ currentTime: data.time, paused: !data.playing, ended: false }, null);
        let active = -1;
        for (let i = 0; i < state.current.lines.length; i++) if (state.current.lines[i].startTime <= time) active = i; else break;
        if (active !== state.current.index) { state.current.index = active; setIndex(active); }
        if (data.bands) {
          // 宿主频段为 0–1，原版主题按 0–255 读取，原始频谱无需换算
          for (const key of ['bass', 'lowMid', 'mid', 'vocal', 'treble'] as const) bands[key].set(Math.max(0, Math.min(1, Number(data.bands[key]) || 0)) * 255);
          audioPower.set(Math.max(0, Math.min(1, Number(data.bands.power) || 0)) * 255);
          if (data.spectrum instanceof Uint8Array) spectrum.set(data.spectrum);
        }
      } else if (data?.type === 'openmusic:folia-beats' && data.key === state.current.key) {
        const events = data.events as BeatFxEvent[];
        setBeatFxEvents(data.key, events, 'openmusic');
        installOpenMusicDrumHits(data.key, {
          times: Float64Array.from(events.map(beat => beat.t)),
          strengths: Float32Array.from(events.map(beat => beat.impact ?? 0.5)),
          kinds: Uint8Array.from(events.map(beat => !beat.tone || beat.tone.low >= Math.max(beat.tone.mid, beat.tone.high) ? 0 : beat.tone.mid >= beat.tone.high ? 1 : 2)),
        });
      }
      else if (data?.type === 'openmusic:folia-settings') setPanel(Boolean(data.open));
      else if (data?.type === 'openmusic:folia-theme') setAutoTheme(previous => ({ ...previous, ...data.theme }));
    };
    window.addEventListener('message', receive);
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !state.current.panel) return;
      const scope = getFoliaPortalRoot().getRootNode() as Document | ShadowRoot;
      if (scope.querySelector('[role="dialog"], [role="listbox"], .st-pop')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPanel(false);
    };
    window.addEventListener('keydown', keydown, true);
    send('openmusic:folia-ready');
    return () => { window.removeEventListener('message', receive); window.removeEventListener('keydown', keydown, true); beginBeatFxTrack(null); send('openmusic:folia-panel', { open: false }); };
  }, [bands, currentTime, audioPower]);
  const mode = settings.visualizerMode;
  const entry = getVisualizerRegistryEntry(mode);
  const tuning = getVisualizerTuning(mode);
  const backgroundMode = settings.visualizerBackgroundMode || 'latent';
  const background = {
    mode: backgroundMode, ...backgroundTuningConfig(settings), customImage: assets.monetBackgroundImage,
    common: { opacity: settings.backgroundOpacity, useCoverColorBg: coverColorBg, disableGeometricBackground: settings.disableVisualizerGeometricBackground, disableVignette: settings.disableVisualizerVignette },
    url: { items: settings.urlBackgroundList, selectedId: settings.urlBackgroundSelectedId },
  };
  const actions = {
    ...backgroundTuningActions(settings),
    common: { onOpacityChange: settings.handleSetBackgroundOpacity, onCoverColorChange: (enabled: boolean) => { setCoverColorBg(enabled); localStorage.setItem('openmusic:folia-cover-colors', enabled ? 'on' : 'off'); }, onDisableGeometricChange: settings.handleToggleDisableVisualizerGeometricBackground, onDisableVignetteChange: settings.handleToggleDisableVisualizerVignette },
    url: { onAdd: settings.handleAddUrlBackgroundItem, onUpdate: settings.handleUpdateUrlBackgroundItem, onDelete: settings.handleDeleteUrlBackgroundItem, onSelect: settings.handleSetUrlBackgroundSelectedId },
    customImage: { onUpload: settings.handleUploadMonetBackgroundImage, onClear: settings.handleClearMonetBackgroundImage, isLoading: assets.isLoadingMonetBackgroundImage },
  };
  const changeTuning = (patch: object) => { if (tuning) (settings[tuning.settingsSetterKey] as ((patch: object) => void) | undefined)?.(patch); };
  const close = () => setPanel(false);
  const beatControls = (effects: readonly BeatEffectDef[] | undefined) => offeredBeatEffects(effects).map(effect => {
    const value = resolveBeatEffectSetting(settings.smartBeat, effect.id);
    return <div className="st-card folia-settings-group" key={effect.id}>
      <Row label={t(effect.nameKey)} hint={t(effect.descKey)}><Toggle checked={value.on} onChange={on => settings.handleSetSmartBeat({ effects: { [effect.id]: { on } } })} /></Row>
      <Row label="强度"><Slider stacked value={value.strength} min={0} max={2} step={0.05} format={strength => `${strength.toFixed(2)}x`} onChange={strength => settings.handleSetSmartBeat({ effects: { [effect.id]: { strength } } })} /></Row>
    </div>;
  });
  useEffect(() => {
    const effects = [...(entry.beatEffects || []), ...(getVisualizerBackgroundRegistryEntry(backgroundMode).beatEffects || [])];
    setBeatFxLiveEffects(Object.fromEntries(effects.filter(effect => isBeatEffectLive(settings.smartBeat, effect)).map(effect => [effect.id, resolveBeatEffectSetting(settings.smartBeat, effect.id).strength])));
    return () => setBeatFxLiveEffects({});
  }, [entry, backgroundMode, settings.smartBeat]);
  const controlTheme: Theme = { ...theme, primaryColor: '#f2f0e9', accentColor: '#00f5d4' };
  return <SettingsKitThemeContext.Provider value={{ isDaylight: false, theme: controlTheme }}><main className="folia-stage" style={{ backgroundColor: theme.backgroundColor }}>
    <VisualizerRenderer mode={mode} animateStyleSwitch currentTime={currentTime} currentLineIndex={index} lines={lines}
      theme={theme} audioPower={audioPower} audioBands={bands} paused={paused} staticMode={staticMode}
      songTitle={song.name} songArtist={song.artist} coverUrl={song.cover} duration={song.duration} seed={song.key}
      visualizerOpacity={settings.visualizerOpacity}
      background={background} visualizerTunings={collectVisualizerTunings(settings)} onVisualizerTuningChange={changeTuning}
      lyricsFontScale={scale} showSubtitleTranslation={translation} hideTranslationSubtitle={!translation}
      showText showHarmonySubtitle isPlayerChromeHidden={!panel} isPanelOpen={panel}
      cappellaCustomEmojiImages={assets.cappellaCustomEmojiImages} cappellaCustomAvatarImages={assets.cappellaCustomAvatarImages}
      monetPortraitImage={assets.monetPortraitImage} onBack={close} onLyricLineSeek={time => send('openmusic:folia-seek', { time: Math.max(0, time - offset) })} />
    {!lines.length && <div className="folia-empty" role="status"><p>{song.name || '音乐即将开始'}</p><span>{status}</span></div>}
    {panel && <aside className="folia-controls st-window" aria-labelledby="folia-controls-title" style={{ ...settingsTokens(false, controlTheme), ...kitMotionTokens(staticMode), '--text-primary': '#f2f0e9' } as React.CSSProperties}>
      <header className="folia-controls-header"><div><h2 id="folia-controls-title">视觉控制台</h2><p>FOLIA VISUALS · 歌词与背景调节</p></div><button type="button" className="folia-controls-close" aria-label="关闭视觉控制台" onClick={close}><X size={16} /></button></header>
      <nav aria-label="调节分类">{[['lyrics', '歌词'], ['background', '背景'], ['appearance', '外观']].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <div className="folia-controls-body">
        {tab === 'lyrics' && <>
          <div className="st-card folia-settings-group"><Row label="歌词主题"><Select value={mode} onChange={value => settings.handleSetVisualizerMode(value, { notify: false })} options={VISUALIZER_REGISTRY.map(item => ({ value: item.mode, label: t(item.labelKey, item.labelFallback) }))} /></Row></div>
          <p className="folia-status">{status}</p>
          {beatControls(entry.beatEffects)}
          {entry.renderSettingsPanel?.({ t, isDaylight: false, theme: controlTheme, controlCardBg: 'bg-white/5', rangeInputClass: 'w-full', tuning: tuning ? settings[tuning.settingsKey] : undefined, onTuningChange: changeTuning, settings: { ...settings, ...assets } })}
          {tuning?.settingsResetterKey && <button className="folia-reset" onClick={() => (settings[tuning.settingsResetterKey!] as (() => void) | undefined)?.()}>重置当前主题参数</button>}
        </>}
        {tab === 'background' && <>
          <div className="st-card folia-settings-group"><Row label="背景"><Select value={backgroundMode} onChange={value => settings.handleSetVisualizerBackgroundMode(value)} options={VISUALIZER_BACKGROUND_REGISTRY.map(item => ({ value: item.mode, label: t(item.labelKey, item.labelFallback) }))} /></Row></div>
          {beatControls(getVisualizerBackgroundRegistryEntry(backgroundMode).beatEffects)}
          {getVisualizerBackgroundRegistryEntry(backgroundMode).renderSettingsPanel?.({ config: background, actions, t, isDaylight: false, theme: controlTheme, controlCardBg: 'bg-white/5', rangeInputClass: 'w-full' })}
          <button className="folia-reset" onClick={() => getVisualizerBackgroundRegistryEntry(backgroundMode).resetSettings?.(actions)}>重置当前背景参数</button>
        </>}
        {tab === 'appearance' && <>
          <div className="st-card folia-settings-group">
            <Row label="使用自定义配色"><Toggle checked={customTheme} onChange={checked => { setCustomTheme(checked); localStorage.setItem('openmusic:folia-custom-theme', checked ? 'on' : 'off'); }} /></Row>
            <Row label="歌词大小"><Slider stacked min={0.5} max={2} step={0.05} value={scale} format={value => `${value.toFixed(2)}x`} onChange={value => { setScale(value); localStorage.setItem('openmusic:folia-scale', String(value)); }} /></Row>
            <Row label="歌词偏移"><Slider stacked min={-5} max={5} step={0.1} value={offset} format={value => `${value.toFixed(1)} 秒`} onChange={value => { setOffset(value); localStorage.setItem('openmusic:folia-offset', String(value)); }} /></Row>
            <Row label="显示翻译"><Toggle checked={translation} onChange={checked => { setTranslation(checked); localStorage.setItem('openmusic:folia-translation', checked ? 'on' : 'off'); }} /></Row>
            <Row label="减少动态效果"><Toggle checked={staticMode} onChange={checked => { setStaticMode(checked); localStorage.setItem('openmusic:folia-static', checked ? 'on' : 'off'); }} /></Row>
            <Row label="每首歌随机主题"><Toggle checked={settings.randomVisualizerModePerSong} onChange={checked => settings.handleToggleRandomVisualizerModePerSong(checked, { notify: false })} /></Row>
            <Row label="节拍联动"><Select value={settings.smartBeat.mode} onChange={(value: SmartBeatMode) => settings.handleSetSmartBeat({ mode: value })} options={[{ value: 'off', label: '关闭' }, { value: 'cached', label: '仅使用已有分析' }, { value: 'on', label: '跟随房间音频分析' }]} /></Row>
            <Row label="歌词透明度"><Slider stacked min={0.2} max={1} step={0.05} value={settings.visualizerOpacity} format={value => `${Math.round(value * 100)}%`} onChange={settings.handleSetVisualizerOpacity} /></Row>
            <Row label="动画强度"><Select value={theme.animationIntensity} onChange={value => setTheme({ animationIntensity: value })} options={[{ value: 'calm', label: '柔和' }, { value: 'normal', label: '标准' }, { value: 'chaotic', label: '强烈' }]} /></Row>
            <Row label="字体"><Select value={theme.fontStyle} onChange={value => setTheme({ fontStyle: value })} options={[{ value: 'sans', label: '无衬线' }, { value: 'serif', label: '衬线' }, { value: 'mono', label: '等宽' }]} /></Row>
            <Row label="字重"><Slider stacked min={300} max={900} step={100} value={theme.fontWeight || 600} format={String} onChange={value => setTheme({ fontWeight: value })} /></Row>
            <Row label="帧率"><Select value={String(settings.visualizerFrameRate)} onChange={value => settings.handleSetVisualizerFrameRate(value === 'off' ? 'off' : Number(value) as VisualizerFrameRate)} options={[{ value: '60', label: '60' }, { value: '90', label: '90' }, { value: '120', label: '120' }, { value: 'off', label: '跟随屏幕' }]} /></Row>
            {(['backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'] as const).map((key, index) => <Row key={key} label={['背景颜色', '歌词颜色', '强调颜色', '辅助颜色'][index]}><input aria-label={['背景颜色', '歌词颜色', '强调颜色', '辅助颜色'][index]} type="color" value={theme[key]} onChange={event => setTheme({ ...theme, [key]: event.target.value }, true)} /></Row>)}
          </div>
          <footer className="folia-source"><span>Folia · AGPL-3.0</span><a href="/vendor/folia/LICENSE.txt" target="_blank" rel="noreferrer">许可证</a><a href="/vendor/folia/source.zip" download>本版本舞台源码</a></footer>
        </>}
      </div>
    </aside>}
  </main></SettingsKitThemeContext.Provider>;
}

class StageBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { send('openmusic:folia-error'); }
  render() { return this.state.failed ? <div className="folia-empty">舞台加载失败<button onClick={() => location.reload()}>重新加载</button></div> : this.props.children; }
}
export function mountFolia(container: Element | DocumentFragment) {
  installGlobalVisualizerFrameRateLimiter(useVisualizerSettingsStore.getState().visualizerFrameRate);
  const stageContainer = document.createElement('div');
  stageContainer.style.cssText = 'width:100%;height:100%';
  const portal = document.createElement('div');
  portal.dataset.foliaPortal = 'true';
  portal.style.cssText = 'display:contents;--text-primary:#f2f0e9';
  container.append(stageContainer, portal);
  setFoliaPortalRoot(portal);
  const root = createRoot(stageContainer);
  root.render(<SheetLayerContext.Provider value={portal}><StageBoundary><Stage /></StageBoundary></SheetLayerContext.Provider>);
  return () => { root.unmount(); restoreGlobalVisualizerFrameRateLimiter(); setFoliaPortalRoot(null); stageContainer.remove(); portal.remove(); };
}
if (location.pathname === '/vendor/folia/index.html') mountFolia(document.getElementById('root')!);
