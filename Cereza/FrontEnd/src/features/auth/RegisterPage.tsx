/**
 * features/auth/RegisterPage.tsx — Crear cuenta (productor o comprador).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Coffee, Mail, Lock, User as UserIcon, ArrowRight, AlertCircle, Eye, EyeOff, Sprout, ShoppingBag, Building2, Hash } from 'lucide-react';
import { authApi, type RegisterPayload } from '../../lib/api/endpoints/auth';
import { useAuthStore } from '../../lib/auth/store';
import { ApiError } from '../../lib/api/client';

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [nombre, setNombre]     = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [role, setRole]         = useState<'producer' | 'buyer'>('producer');
  const [nombreEmpresa, setNombreEmpresa] = useState('');
  const [nit, setNit] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const payload: RegisterPayload = {
        email: email.trim().toLowerCase(), password, nombre: nombre.trim(), role,
        ...(role === 'buyer'
          ? { nombreEmpresa: nombreEmpresa.trim(), ...(nit.trim() ? { nit: nit.trim() } : {}) }
          : {}),
      };
      return authApi.register(payload);
    },
    onSuccess: (data) => {
      setSession(data);
      navigate('/', { replace: true });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!nombre || !email || !passwordValid(password)) return;
    if (role === 'buyer' && !nombreEmpresa.trim()) return;
    mutation.mutate();
  };

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <div className="min-h-[calc(100vh-var(--header-h))] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg cv-card p-6 sm:p-8 cv-fade-in">
        <header className="flex items-center gap-2 mb-5">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--color-primary)', color: '#fff' }}>
            <Coffee size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold leading-tight">Crear cuenta</h1>
            <p className="text-xs" style={{ color: 'var(--color-text-mute)' }}>
              Empieza a usar CaféVision en menos de un minuto.
            </p>
          </div>
        </header>

        {/* Selector de rol */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <RoleCard
            active={role === 'producer'} onClick={() => setRole('producer')}
            icon={<Sprout size={20} />} title="Productor"
            desc="Analizo mis cosechas y vendo lotes."
          />
          <RoleCard
            active={role === 'buyer'} onClick={() => setRole('buyer')}
            icon={<ShoppingBag size={20} />} title="Comprador"
            desc="Busco lotes verificados de café."
          />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {apiError && (
            <div className="cv-card p-3 flex items-start gap-2"
                 style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm space-y-2 flex-1">
                <span>
                  {apiError.code === 'email_exists' || apiError.code === 'email_already_registered'
                    ? 'Ya existe una cuenta con ese correo.'
                    : apiError.code === 'buyer_requires_nombreEmpresa'
                    ? 'Como comprador debes indicar el nombre de tu empresa.'
                    : apiError.code === 'password_too_short'
                    ? 'La contraseña debe tener al menos 10 caracteres.'
                    : apiError.code === 'password_too_long'
                    ? 'La contraseña es demasiado larga (máximo 128 caracteres).'
                    : apiError.code === 'password_too_weak'
                    ? 'La contraseña debe incluir minúscula, MAYÚSCULA, dígito y símbolo.'
                    : apiError.code === 'validation_error'
                    ? 'Algún dato no cumple los requisitos (revisa correo y contraseña).'
                    : apiError.message || 'No se pudo crear la cuenta.'}
                </span>
                {(apiError.code === 'email_exists' || apiError.code === 'email_already_registered') && (
                  <div>
                    <button
                      type="button"
                      onClick={() => navigate('/login', {
                        state: { email: email.trim().toLowerCase(), notice: 'Ese correo ya está registrado. Inicia sesión con tu contraseña.' },
                      })}
                      className="cv-btn cv-btn-outline cv-btn-sm"
                    >
                      Ir a iniciar sesión <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="cv-label">Nombre completo</label>
            <div className="relative">
              <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--color-text-mute)' }} />
              <input
                type="text" required autoComplete="name" minLength={2} maxLength={120}
                className="cv-input pl-9"
                placeholder="Cómo te llamas"
                value={nombre} onChange={(e) => setNombre(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="cv-label">Correo</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-mute)' }} />
              <input
                type="email" required autoComplete="email"
                className="cv-input pl-9"
                placeholder="tu@correo.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {role === 'buyer' && (
            <>
              <div>
                <label className="cv-label">Nombre de la empresa</label>
                <div className="relative">
                  <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                             style={{ color: 'var(--color-text-mute)' }} />
                  <input
                    type="text" required minLength={2} maxLength={200}
                    className="cv-input pl-9"
                    placeholder="Café Importadores S.A.S."
                    value={nombreEmpresa} onChange={(e) => setNombreEmpresa(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="cv-label">NIT (opcional)</label>
                <div className="relative">
                  <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--color-text-mute)' }} />
                  <input
                    type="text" maxLength={40}
                    className="cv-input pl-9"
                    placeholder="900.123.456-7"
                    value={nit} onChange={(e) => setNit(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="cv-label">Contraseña</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-mute)' }} />
              <input
                type={showPwd ? 'text' : 'password'} required minLength={10} maxLength={128} autoComplete="new-password"
                className="cv-input pl-9 pr-10"
                placeholder="Mínimo 10 caracteres"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button" onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-[var(--color-surface-2)]"
                style={{ color: 'var(--color-text-mute)' }}
                aria-label={showPwd ? 'Ocultar' : 'Mostrar'}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <PasswordStrength password={password} />
          </div>

          <button
            type="submit" disabled={mutation.isPending || !passwordValid(password) || !nombre.trim() || !email.trim() || (role === 'buyer' && !nombreEmpresa.trim())}
            className="cv-btn cv-btn-primary cv-btn-lg w-full"
          >
            {mutation.isPending ? 'Creando cuenta…' : <>Crear cuenta <ArrowRight size={18} /></>}
          </button>

          <p className="text-sm text-center" style={{ color: 'var(--color-text-mute)' }}>
            ¿Ya tienes cuenta? <Link to="/login" className="font-medium">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

function RoleCard({
  active, onClick, icon, title, desc,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className="p-3 rounded-2xl border text-left transition-all"
      style={{
        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
        background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
        color: active ? 'var(--color-primary)' : 'var(--color-text-soft)',
        boxShadow: active ? 'var(--shadow-glow)' : 'none',
      }}
    >
      <div className="flex items-center gap-2 font-semibold text-sm">{icon} {title}</div>
      <p className="text-xs mt-1" style={{ color: 'var(--color-text-mute)' }}>{desc}</p>
    </button>
  );
}

function passwordChecks(p: string) {
  return {
    length: p.length >= 10 && p.length <= 128,
    lower:  /[a-z]/.test(p),
    upper:  /[A-Z]/.test(p),
    digit:  /[0-9]/.test(p),
    symbol: /[^A-Za-z0-9]/.test(p),
  };
}
function passwordValid(p: string): boolean {
  const c = passwordChecks(p);
  return c.length && c.lower && c.upper && c.digit && c.symbol;
}

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const c = passwordChecks(password);
  const score = Number(c.length) + Number(c.lower && c.upper) + Number(c.digit) + Number(c.symbol);
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente'];
  const colors = ['var(--score-bad)', 'var(--score-bad)', 'var(--score-mid)', 'var(--score-good)', 'var(--score-best)'];
  const items: { ok: boolean; label: string }[] = [
    { ok: c.length, label: '10–128 caracteres' },
    { ok: c.lower,  label: 'minúscula' },
    { ok: c.upper,  label: 'MAYÚSCULA' },
    { ok: c.digit,  label: 'dígito' },
    { ok: c.symbol, label: 'símbolo (!@#$…)' },
  ];
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-3)' }}>
          <div className="h-full transition-all"
               style={{ width: `${(score / 4) * 100}%`, background: colors[score] }} />
        </div>
        <span className="text-[11px]" style={{ color: 'var(--color-text-mute)' }}>{labels[score]}</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {items.map((it) => (
          <li key={it.label} className="inline-flex items-center gap-1"
              style={{ color: it.ok ? 'var(--color-success)' : 'var(--color-text-mute)' }}>
            <span style={{ fontSize: 10 }}>{it.ok ? '✓' : '○'}</span> {it.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
