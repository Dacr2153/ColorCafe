/**
 * components/layout/AppShell.tsx — Shell de toda la app.
 *
 * - Header sticky con glass effect y branding.
 * - Main con padding adaptativo.
 * - Bottom nav en mobile (md:hidden).
 * - Footer minimal.
 */
import { type ReactNode } from 'react';
import { Link, NavLink, Navigate, useNavigate } from 'react-router-dom';
import {
  Coffee, LogIn, UserPlus, LogOut, User as UserIcon,
  LayoutDashboard, Camera, BarChart3, Store, Newspaper,
} from 'lucide-react';
import { useAuthStore, selectIsAuthenticated } from '../../lib/auth/store';
import { authApi } from '../../lib/api/endpoints/auth';
import { NetworkBanner } from '../common/NetworkBanner';
import { UpdatePrompt } from '../common/UpdatePrompt';

interface NavItem { to: string; label: string; icon: ReactNode; auth?: boolean; }

const NAV_ITEMS: NavItem[] = [
  { to: '/',            label: 'Inicio',      icon: <LayoutDashboard size={18} /> },
  { to: '/capture',     label: 'Analizar',    icon: <Camera size={18} />,        auth: true },
  { to: '/metrics',     label: 'Métricas',    icon: <BarChart3 size={18} />,     auth: true },
  { to: '/marketplace', label: 'Marketplace', icon: <Store size={18} /> },
  { to: '/news',        label: 'Noticias',    icon: <Newspaper size={18} /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const isAuth = useAuthStore(selectIsAuthenticated);
  const visibleItems = NAV_ITEMS.filter((it) => !it.auth || isAuth);

  return (
    <div className="min-h-screen flex flex-col cv-bg">
      <Header isAuth={isAuth} items={visibleItems} />
      <NetworkBanner />
      <main className="flex-grow w-full" style={{ paddingBottom: `calc(var(--mobile-nav-h) + env(safe-area-inset-bottom))` }}>
        <div className="cv-fade-in">{children}</div>
      </main>
      <Footer />
      <MobileBottomNav items={visibleItems} isAuth={isAuth} />
      <UpdatePrompt />
    </div>
  );
}

/* ─────────────── Header ─────────────── */
function Header({ isAuth, items }: { isAuth: boolean; items: NavItem[] }) {
  return (
    <header
      className="cv-glass sticky top-0 z-40"
      style={{ height: 'var(--header-h)' }}
    >
      <div className="max-w-[var(--max-w)] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 group" style={{ textDecoration: 'none' }}>
          <span className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--color-primary)', color: '#fff' }}>
            <Coffee size={20} />
          </span>
          <span className="hidden sm:inline font-semibold tracking-tight" style={{ color: 'var(--color-text)' }}>
            CaféVision
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                  isActive ? 'cv-chip-primary' : 'cv-btn-ghost'
                }`
              }
              style={{ textDecoration: 'none' }}
            >
              {it.icon} {it.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {isAuth ? <UserMenu /> : <GuestActions />}
        </div>
      </div>
    </header>
  );
}

function GuestActions() {
  return (
    <>
      <Link to="/login" className="cv-btn cv-btn-ghost cv-btn-sm">
        <LogIn size={16} /> <span className="hidden sm:inline">Entrar</span>
      </Link>
      <Link to="/register" className="cv-btn cv-btn-primary cv-btn-sm">
        <UserPlus size={16} /> <span className="hidden sm:inline">Crear cuenta</span>
      </Link>
    </>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clear = useAuthStore((s) => s.clear);

  const handleLogout = async () => {
    try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* sin red, seguimos */ }
    clear();
    navigate('/', { replace: true });
  };

  const initial = (user?.nombre || user?.email || '?').trim()[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/profile"
        title="Mi perfil"
        className="flex items-center gap-2 px-2 py-1.5 rounded-full transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ textDecoration: 'none', color: 'var(--color-text)' }}
      >
        <span className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm"
              style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
          {initial}
        </span>
        <span className="hidden md:inline text-sm font-medium max-w-[140px] truncate">
          {user?.nombre || user?.email}
        </span>
      </Link>
      <button
        onClick={handleLogout}
        title="Cerrar sesión"
        className="cv-btn cv-btn-ghost cv-btn-sm"
      >
        <LogOut size={16} />
        <span className="hidden md:inline">Salir</span>
      </button>
    </div>
  );
}

/* ─────────────── Footer ─────────────── */
function Footer() {
  return (
    <footer className="hidden md:block py-6 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <div className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-xs" style={{ color: 'var(--color-text-mute)' }}>
          © {new Date().getFullYear()} CaféVision — Análisis honesto para caficultores.
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-mute)' }}>
          Datos en tiempo real. Sin valores simulados.
        </p>
      </div>
    </footer>
  );
}

/* ─────────────── Mobile bottom nav ─────────────── */
function MobileBottomNav({ items, isAuth }: { items: NavItem[]; isAuth: boolean }) {
  // 5 ítems en móvil para incluir Noticias.
  const fixed: NavItem[] = isAuth
    ? [
        { to: '/',            label: 'Inicio',      icon: <LayoutDashboard size={20} /> },
        { to: '/capture',     label: 'Analizar',    icon: <Camera size={20} /> },
        { to: '/marketplace', label: 'Mercado',     icon: <Store size={20} /> },
        { to: '/news',        label: 'Noticias',    icon: <Newspaper size={20} /> },
        { to: '/profile',     label: 'Perfil',      icon: <UserIcon size={20} /> },
      ]
    : [
        { to: '/',            label: 'Inicio',      icon: <LayoutDashboard size={20} /> },
        { to: '/marketplace', label: 'Mercado',     icon: <Store size={20} /> },
        { to: '/news',        label: 'Noticias',    icon: <Newspaper size={20} /> },
        { to: '/login',       label: 'Entrar',      icon: <LogIn size={20} /> },
        { to: '/register',    label: 'Cuenta',      icon: <UserPlus size={20} /> },
      ];
  void items;
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 cv-glass"
      style={{
        height: `calc(var(--mobile-nav-h) + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="grid grid-cols-5 h-full">
        {fixed.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-mute)]'
              }`
            }
            style={{ textDecoration: 'none' }}
          >
            {it.icon}
            <span>{it.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/* ─────────────── Helper: PrivateRoute ─────────────── */
export function PrivateRoute({ children }: { children: ReactNode }) {
  const isAuth = useAuthStore(selectIsAuthenticated);
  if (!isAuth) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
