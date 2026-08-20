/**
 * features/auth/LoginPage.tsx — Iniciar sesión.
 *
 * Layout split: lado izquierdo branding, derecho formulario. En mobile
 * se colapsa a una sola columna con el branding arriba.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Coffee, Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { authApi } from '../../lib/api/endpoints/auth';
import { useAuthStore } from '../../lib/auth/store';
import { ApiError } from '../../lib/api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);

  const navState = (location.state as { from?: string; email?: string; notice?: string } | null) ?? null;
  const [email, setEmail] = useState(navState?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const notice = navState?.notice ?? null;

  const mutation = useMutation({
    mutationFn: () => authApi.login(email.trim().toLowerCase(), password),
    onSuccess: (data) => {
      setSession(data);
      const redirectTo = navState?.from ?? '/';
      navigate(redirectTo, { replace: true });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    mutation.mutate();
  };

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <div className="min-h-[calc(100vh-var(--header-h))] grid md:grid-cols-2">
      {/* Branding */}
      <aside className="hidden md:flex flex-col justify-between p-10 cv-hero-bg">
        <div>
          <div className="inline-flex items-center gap-2 mb-8">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}>
              <Coffee size={22} />
            </span>
            <span className="font-semibold text-lg">CaféVision</span>
          </div>
          <h1 className="text-3xl xl:text-4xl font-bold leading-tight max-w-md"
              style={{ color: 'var(--color-text)' }}>
            Análisis honesto del café que produces.
          </h1>
          <p className="mt-4 max-w-sm" style={{ color: 'var(--color-text-soft)' }}>
            Sube una foto de tu muestra y obtén un análisis trazable, real, basado
            en datos. Sin valores inventados.
          </p>
        </div>
        <Quote />
      </aside>

      {/* Formulario */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <form onSubmit={onSubmit} className="w-full max-w-md space-y-5">
          <header className="md:hidden flex items-center gap-2 mb-4">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}>
              <Coffee size={22} />
            </span>
            <span className="font-semibold">CaféVision</span>
          </header>

          <div>
            <h2 className="text-2xl font-bold">Bienvenido de vuelta</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-mute)' }}>
              Ingresa con tu cuenta para continuar.
            </p>
          </div>

          {notice && !apiError && (
            <div className="cv-card p-3 flex items-start gap-2"
                 style={{ borderColor: 'var(--color-info)', color: 'var(--color-info)' }}>
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span className="text-sm">{notice}</span>
            </div>
          )}

          {apiError && (
            <div className="cv-card p-3 flex items-start gap-2"
                 style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span className="text-sm">
                {apiError.code === 'invalid_credentials'
                  ? 'Email o contraseña incorrectos.'
                  : apiError.message || 'No se pudo iniciar sesión.'}
              </span>
            </div>
          )}

          <div>
            <label className="cv-label">Correo</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-mute)' }} />
              <input
                type="email"
                required
                autoComplete="email"
                className="cv-input pl-9"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="cv-label">Contraseña</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-mute)' }} />
              <input
                type={showPwd ? 'text' : 'password'}
                required
                autoComplete="current-password"
                className="cv-input pl-9 pr-10"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-[var(--color-surface-2)]"
                aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                style={{ color: 'var(--color-text-mute)' }}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="cv-btn cv-btn-primary cv-btn-lg w-full"
          >
            {mutation.isPending ? 'Entrando…' : <>Entrar <ArrowRight size={18} /></>}
          </button>

          <p className="text-sm text-center" style={{ color: 'var(--color-text-mute)' }}>
            ¿Aún no tienes cuenta?{' '}
            <Link to="/register" className="font-medium">Crear cuenta</Link>
          </p>
        </form>
      </section>
    </div>
  );
}

function Quote() {
  return (
    <figure className="max-w-sm">
      <blockquote className="text-sm italic" style={{ color: 'var(--color-text-soft)' }}>
        “Lo que se mide bien, mejora. Nuestro café merece datos reales.”
      </blockquote>
      <figcaption className="mt-2 text-xs" style={{ color: 'var(--color-text-mute)' }}>
        — Equipo CaféVision
      </figcaption>
    </figure>
  );
}
