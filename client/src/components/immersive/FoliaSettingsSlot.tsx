import { useEffect, useRef, useState } from 'react';
import { FOLIA_SETTINGS_HOST_EVENT, FOLIA_SETTINGS_ATTACHED_EVENT, type FoliaSettingsHost, type FoliaSettingsSection } from '../../../../vendor/folia/settingsBridge';

export default function FoliaSettingsSlot({ section }: { section: FoliaSettingsSection }) {
  const element = useRef<HTMLDivElement>(null);
  const connection = useRef<FoliaSettingsHost | null>(null);
  const currentSection = useRef(section);
  currentSection.current = section;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const host = element.current!;
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const popupHost = document.createElement('div');
    popupHost.dataset.foliaSettingsPopup = '';
    popupHost.style.cssText = 'position:fixed;inset:0;z-index:180;pointer-events:none';
    const popupShadow = popupHost.attachShadow({ mode: 'open' });
    document.body.append(popupHost);
    const content = document.createElement('div');
    const portal = document.createElement('div');
    portal.dataset.foliaPortal = 'true';
    portal.style.cssText = 'display:contents;pointer-events:auto;--text-primary:#f2f0e9';
    shadow.append(content);
    popupShadow.append(portal);
    let cancelled = false;
    let loadingStyles = false;
    let mounted = false;
    let poll = 0;
    const cleanups: (() => void)[] = [];
    setState('loading');
    const notify = () => {
      if (!connection.current) return;
      connection.current.section = currentSection.current;
      window.dispatchEvent(new CustomEvent(FOLIA_SETTINGS_HOST_EVENT, { detail: connection.current }));
    };
    const connect = () => {
      if (cancelled) return;
      if (connection.current) { if (!mounted) notify(); return; }
      if (loadingStyles) return;
      const stage = document.querySelector<HTMLElement>('[data-folia-stage]');
      const links = stage?.shadowRoot?.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
      if (!links?.length) return;
      loadingStyles = true;
      // 复用已加载舞台的同版本样式，隔离 Folia 样式，不创建第二个舞台或设置 store
      void Promise.all([shadow, popupShadow].flatMap(root => Array.from(links, source => new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = source.href;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('Folia stylesheet unavailable'));
        cleanups.push(() => { link.onload = null; link.onerror = null; });
        root.append(link);
      })))).then(() => {
        if (cancelled) return;
        connection.current = { content, portal, section: currentSection.current };
        notify();
      }).catch(() => {
        window.clearInterval(poll);
        if (!cancelled) setState('failed');
      });
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type === 'openmusic:folia-ready') { mounted = false; connect(); }
      if (event.data?.type === 'openmusic:folia-error') { window.clearInterval(poll); mounted = false; setState('failed'); }
    };
    const attached = (event: Event) => {
      if ((event as CustomEvent).detail !== content || cancelled) return;
      mounted = true;
      window.clearInterval(poll);
      setState('ready');
    };
    window.addEventListener(FOLIA_SETTINGS_ATTACHED_EVENT, attached);
    const timer = window.setTimeout(() => {
      window.clearInterval(poll);
      if (!mounted) setState('failed');
    }, 30000);
    window.addEventListener('message', receive);
    poll = window.setInterval(connect, 400);
    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener('message', receive);
      window.removeEventListener(FOLIA_SETTINGS_ATTACHED_EVENT, attached);
      connection.current = null;
      window.dispatchEvent(new CustomEvent(FOLIA_SETTINGS_HOST_EVENT, { detail: { detach: content } }));
      cleanups.forEach(cleanup => cleanup());
      shadow.replaceChildren();
      popupHost.remove();
    };
  }, [retry]);

  useEffect(() => {
    if (connection.current) {
      connection.current.section = section;
      window.dispatchEvent(new CustomEvent(FOLIA_SETTINGS_HOST_EVENT, { detail: connection.current }));
    }
  }, [section]);

  return <>
    {state === 'loading' && <p role="status" className="text-sm text-white/60">正在连接 Folia 设置…</p>}
    {state === 'failed' && <div role="alert" className="space-y-3 text-sm text-white/70"><p>Folia 设置暂不可用，可重试或切换到其他预设</p><button type="button" className="fx-mini-btn" onClick={() => setRetry(value => value + 1)}>重新连接</button></div>}
    <div ref={element} data-folia-settings-slot className="min-w-0" />
  </>;
}
