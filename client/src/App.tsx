import { Suspense, useCallback, useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import AppUpdateGate from './components/AppUpdateGate';
import AppErrorBoundary from './components/AppErrorBoundary';
import NotFoundPage from './components/NotFoundPage';
import { rememberAdminEntryPath } from './lib/adminEntryShortcut';
import { lazyWithRetry } from './lib/lazyWithRetry';
import StartupSplash from './components/StartupSplash';
import MusicLoading from './components/MusicLoading';
const AccountGate = lazyWithRetry(() => import('./components/AccountGate'), 'AccountGate');

const Home = lazyWithRetry(() => import('./pages/Home'), 'Home');
const Room = lazyWithRetry(() => import('./pages/Room'), 'Room');
const TvDisplay = lazyWithRetry(() => import('./pages/TvDisplay'), 'TvDisplay');
const Admin = lazyWithRetry(() => import('./pages/Admin'), 'Admin');
const Setup = lazyWithRetry(() => import('./pages/Setup'), 'Setup');

function RouteFallback() {
  const location = useLocation();
  const label = location.pathname.startsWith('/room/') || location.pathname.startsWith('/tv/')
    ? '正在连接房间'
    : '正在连接音乐空间';
  return <MusicLoading label={label} />;
}

function NotFound() {
  return <NotFoundPage />;
}

/** 与服务端 sanitizeAdminEntryPath 对齐：仅合法形态才打 gate，避免 * 通配放大探测 */
function looksLikeAdminEntryPath(pathname: string): boolean {
  if (pathname === '/admin') return true;
  return /^\/[A-Za-z0-9_-]{8,64}$/.test(pathname);
}

/** 仅当当前 pathname 匹配服务端配置的管理入口时渲染后台 */
function AdminGate() {
  const location = useLocation();
  const [match, setMatch] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = location.pathname;

    if (
      path.includes('.')
      || path.startsWith('/assets')
      || path.startsWith('/qface')
      || path.startsWith('/vendor')
      || !looksLikeAdminEntryPath(path)
    ) {
      setMatch(false);
      return;
    }

    setMatch(null);
    (async () => {
      try {
        const res = await fetch('/api/admin/gate', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        const data = await res.json().catch(() => ({}));
        const matched = Boolean(data.match);
        if (!cancelled) {
          setMatch(matched);
          // 只在真正命中管理入口的这台设备本地记住路径，方便下次从首页快捷进入
          if (matched) rememberAdminEntryPath(path);
        }
      } catch {
        if (!cancelled) setMatch(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (match === null) return <RouteFallback />;
  if (!match) return <NotFound />;
  return <Admin />;
}

export default function App() {
  const location = useLocation();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [startupEntered, setStartupEntered] = useState(() => location.pathname !== '/');
  const [startupSettled, setStartupSettled] = useState(false);
  const [homeReady, setHomeReady] = useState(false);
  const handleHomeReady = useCallback(() => setHomeReady(true), []);
  const handleStartupEnter = useCallback(() => setStartupEntered(true), []);
  const showStartup = !startupEntered && location.pathname === '/' && setupRequired !== true;

  useEffect(() => {
    if (location.pathname !== '/' || setupRequired === true) setStartupEntered(true);
  }, [location.pathname, setupRequired]);

  useEffect(() => {
    if (!startupEntered) return;
    // Keep automatic overlays from covering the title handoff.
    const timer = window.setTimeout(() => setStartupSettled(true), 900);
    return () => window.clearTimeout(timer);
  }, [startupEntered]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    fetch('/api/setup/status', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setSetupRequired(Boolean(data.setupRequired));
      })
      .catch(() => {
        // 兼容尚未升级 setup API 的服务端，不阻断正常页面。
        if (!cancelled) setSetupRequired(false);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return (
    <>
      {showStartup && <StartupSplash ready={homeReady} onEnter={handleStartupEnter} />}
      <div className="h-full">
        {setupRequired === false && startupSettled && <AppUpdateGate />}
        <AppErrorBoundary key={location.pathname} onError={handleStartupEnter}>
          <Suspense fallback={<RouteFallback />}>
            {setupRequired === null ? <RouteFallback /> : setupRequired ? (
              <Setup />
            ) : (
              <Routes>
                <Route path="/" element={<AccountGate allowPreview onReady={handleHomeReady}><Home entryReady={startupSettled} entranceActive={showStartup} onReady={handleHomeReady} /></AccountGate>} />
                <Route path="/room/:roomId" element={<AccountGate><Room /></AccountGate>} />
                <Route path="/tv/:roomId" element={<AccountGate><TvDisplay /></AccountGate>} />
                <Route path="*" element={<AdminGate />} />
              </Routes>
            )}
          </Suspense>
        </AppErrorBoundary>
      </div>
    </>
  );
}
