/**
 * App.tsx — Composición raíz: providers + router + shell.
 *
 * Sin Redux. Auth via Zustand. Rutas planas (sin prefijo /v2).
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders } from './lib/AppProviders';
import { AppShell, PrivateRoute } from './components/layout/AppShell';
import { useOnlineFlush } from './lib/offline/useOnlineFlush';

import { HomePage } from './features/home/HomePage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { CapturePage } from './features/capture/CapturePage';
import { MetricsPage } from './features/metrics/MetricsPage';
import { MarketplacePage } from './features/marketplace/MarketplacePage';
import { ListingDetailPage } from './features/marketplace/ListingDetailPage';
import { MyListingsPage } from './features/marketplace/MyListingsPage';
import { MyOrdersPage } from './features/marketplace/MyOrdersPage';
import { OrderDetailPage } from './features/marketplace/OrderDetailPage';
import { NewsListPage } from './features/news/NewsListPage';
import { NewsDetailPage } from './features/news/NewsDetailPage';

function OfflineBridge() {
  useOnlineFlush();
  return null;
}

export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <OfflineBridge />
        <AppShell>
          <Routes>
            {/* Públicas */}
            <Route path="/"                  element={<HomePage />} />
            <Route path="/login"             element={<LoginPage />} />
            <Route path="/register"          element={<RegisterPage />} />
            <Route path="/marketplace"       element={<MarketplacePage />} />
            <Route path="/marketplace/:id"   element={<ListingDetailPage />} />
            <Route path="/news"              element={<NewsListPage />} />
            <Route path="/news/:id"          element={<NewsDetailPage />} />

            {/* Privadas */}
            <Route path="/profile"           element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
            <Route path="/capture"           element={<PrivateRoute><CapturePage /></PrivateRoute>} />
            <Route path="/metrics"           element={<PrivateRoute><MetricsPage /></PrivateRoute>} />
            <Route path="/marketplace/mine"  element={<PrivateRoute><MyListingsPage /></PrivateRoute>} />
            <Route path="/marketplace/orders" element={<PrivateRoute><MyOrdersPage /></PrivateRoute>} />
            <Route path="/marketplace/orders/:id" element={<PrivateRoute><OrderDetailPage /></PrivateRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </AppProviders>
  );
}
