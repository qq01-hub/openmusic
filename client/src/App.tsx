import { Suspense, useCallback, useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import AppUpdateGate from './components/AppUpdateGate';
import AppErrorBoundary from './components/AppErrorBoundary';
import NotFoundPage from './components/NotFoundPage';
import { rememberAdminEntryPath } from './lib/adminEntryShortcut';
import { lazyWithRetry } from './lib/lazyWithRetry';
import StartupSplash from './components/StartupSplash';

const STARTUP_SEEN_KEY = 'openmusic:startup-splash-seen-day';

function currentChinaDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function hasSeenStartupToday() {
  try { return localStorage.getItem(STARTUP_SEEN_KEY) === currentChinaDate(); }
  catch { return false; }
}

function markStartupSeenToday() {
  try { localStorage.setItem(STARTUP_SEEN_KEY, currentChinaDate()); }
  catch { /* 当前页面仍然正常展示 */ }
}
import MusicLoading from './components/MusicLoading';
const AccountGate = lazyWithRetry(() => import('./components/AccountGate'), 'AccountGate');

const Home = lazyWithRetry(() => import('./pages/Home'), 'Home');
const Room = lazyWithRetry(() => import('./pages/Room'), 'Room');
const TvDisplay = lazyWithRetry(() => import('./pages/TvDisplay'), 'TvDisplay');
const Admin = lazyWithRetry(() => import('./pages/Admin'), 'Admin');
const Setup = lazyWithRetry(() => import('./pages/Setup'), 'Setup');

let adminBundlePreload: Promise<unknown> | null = null;
function preloadAdminBundle() {
  if (!adminBundlePreload) {
    adminBundlePreload = import('./pages/Admin').catch(() => {
      adminBundlePreload = null;
    });
  }
  return adminBundlePreload;
}

let initialRouteBundleReady = false;
let initialRoutePreloadPromise: Promise<unknown> = Promise.resolve();

if (typeof window !== 'undefined') {
  const initialPath = window.location.pathname;
  const tasks: Promise<unknown>[] = [import('./components/AccountGate').catch(() => undefined)];
  if (initialPath === '/') {
    tasks.push(import('./pages/Home').catch(() => undefined));
  } else if (initialPath.startsWith('/room/')) {
    tasks.push(import('./pages/Room').then((m) => m.preloadRoomShell()).catch(() => undefined));
  } else if (initialPath.startsWith('/tv/')) {
    tasks.push(import('./pages/TvDisplay').catch(() => undefined));
  } else if (initialPath === '/admin' || /^\/[A-Za-z0-9_-]{8,64}$/.test(initialPath)) {
    tasks.push(preloadAdminBundle());
  }
  initialRoutePreloadPromise = Promise.all(tasks).finally(() => {
    initialRouteBundleReady = true;
  });
}

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
    void preloadAdminBundle();
    (async () => {
      try {
        const [res] = await Promise.all([
          fetch('/api/admin/gate', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
          }),
          preloadAdminBundle(),
        ]);
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
  const [startupEntered, setStartupEntered] = useState(() => location.pathname !== '/' || hasSeenStartupToday());
  const [startupSettled, setStartupSettled] = useState(false);
  const [homeReady, setHomeReady] = useState(false);
  const handleHomeReady = useCallback(() => setHomeReady(true), []);
  const handleStartupEnter = useCallback(() => {
    markStartupSeenToday();
    setStartupEntered(true);
  }, []);
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
    const setupFetch = fetch('/api/setup/status', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((response) => response.json())
      .then((data) => Boolean(data.setupRequired))
      .catch(() => false);
    Promise.all([
      setupFetch,
      initialRouteBundleReady ? Promise.resolve() : initialRoutePreloadPromise,
    ])
      .then(([required]) => {
        if (!cancelled) setSetupRequired(required);
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
