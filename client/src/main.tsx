import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { installOpenMusicDebug } from './lib/debugTools';
import { installVisibilitySync } from './lib/visibilitySync';
import { applyPageSeo, fetchSiteSeo, removeSeoBootstrap } from './lib/seo';
import { ensureSessionBootstrap } from './lib/sessionBootstrap';
import { refreshQualityCapabilities } from './api/music/quality';
import { applyStoredRoomThemeColor } from './lib/roomThemeColor';
import { installGuideUsageTracking } from './lib/userGuide';
import { prefetchLoadingQuote } from './lib/loadingQuote';
import { fetchAccountSession } from './lib/accountAuth';

applyStoredRoomThemeColor();
void fetchAccountSession().catch(() => undefined);
installOpenMusicDebug();
installVisibilitySync();
installGuideUsageTracking();
void prefetchLoadingQuote();
void fetchSiteSeo().then(() => applyPageSeo());
applyPageSeo();
void ensureSessionBootstrap().then(() => {
  const refresh = () => void refreshQualityCapabilities();
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(refresh, { timeout: 5000 });
  } else {
    window.setTimeout(refresh, 2500);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

removeSeoBootstrap();
