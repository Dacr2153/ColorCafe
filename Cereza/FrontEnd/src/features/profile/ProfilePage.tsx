/**
 * features/profile/ProfilePage.tsx — Perfil del usuario.
 *
 * Para productores muestra el perfil + lista de fincas reales (sin thumbnails fake).
 * Para compradores muestra solo los datos de cuenta.
 */
import { useState, useEffect, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User as UserIcon, Mail, Sprout, MapPin, Phone, Save, Plus, Loader2,
  CheckCircle2, AlertCircle, Mountain, Pencil,
} from 'lucide-react';
import { useAuthStore } from '../../lib/auth/store';
import { farmerApi } from '../../lib/api/endpoints/farmer';
import { ApiError } from '../../lib/api/client';
import { EmptyState } from '../../components/common/EmptyState';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const isProducer = user?.role === 'producer';

  return (
    <div className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Mi perfil</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-mute)' }}>
          Información de tu cuenta y datos de productor.
        </p>
      </header>

      <AccountCard />

      {isProducer && (
        <>
          <ProducerProfileCard />
          <FarmsCard />
        </>
      )}
    </div>
  );
}

/* ─────────── Cuenta ─────────── */
function AccountCard() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const initial = (user.nombre || user.email)[0]?.toUpperCase() ?? '?';
  return (
    <section className="cv-card p-5 sm:p-6 flex items-center gap-4">
      <span className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-semibold shrink-0"
            style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">{user.nombre || 'Sin nombre'}</div>
        <div className="flex items-center gap-1.5 text-sm truncate" style={{ color: 'var(--color-text-mute)' }}>
          <Mail size={14} /> <span className="truncate">{user.email}</span>
        </div>
        <div className="mt-2">
          <span className="cv-chip cv-chip-accent">
            <UserIcon size={12} /> {roleLabel(user.role)}
          </span>
        </div>
      </div>
    </section>
  );
}

function roleLabel(r: string) {
  if (r === 'producer') return 'Productor';
  if (r === 'buyer')    return 'Comprador';
  if (r === 'admin')    return 'Administrador';
  return r;
}

/* ─────────── Perfil productor ─────────── */
function ProducerProfileCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['farmer', 'profile'],
    queryFn: () => farmerApi.getProfile(),
  });

  const [form, setForm] = useState({
    nombre: '', departamento: '', municipio: '', telefono: '', bio: '',
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (q.data) {
      setForm({
        nombre:       q.data.nombre       || '',
        departamento: q.data.departamento || '',
        municipio:    q.data.municipio    || '',
        telefono:     q.data.telefono     || '',
        bio:          q.data.bio          || '',
      });
    }
  }, [q.data]);

  const m = useMutation({
    mutationFn: () => farmerApi.updateProfile(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['farmer', 'profile'] });
      setSavedAt(Date.now());
    },
  });

  const onSubmit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  const err = m.error instanceof ApiError ? m.error : null;

  return (
    <section className="cv-card p-5 sm:p-6">
      <h2 className="font-semibold flex items-center gap-2"><Pencil size={16} /> Datos del productor</h2>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-mute)' }}>
        Esta información puede compartirse con compradores al publicar un lote.
      </p>

      {q.isLoading ? (
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          {[1,2,3,4].map(i => <div key={i} className="cv-skeleton h-10" />)}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 grid sm:grid-cols-2 gap-3">
          <Field label="Nombre" icon={<UserIcon size={14} />}
                 value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} />
          <Field label="Teléfono" icon={<Phone size={14} />}
                 value={form.telefono} onChange={(v) => setForm({ ...form, telefono: v })} />
          <Field label="Departamento" icon={<MapPin size={14} />}
                 value={form.departamento} onChange={(v) => setForm({ ...form, departamento: v })} />
          <Field label="Municipio" icon={<MapPin size={14} />}
                 value={form.municipio} onChange={(v) => setForm({ ...form, municipio: v })} />
          <div className="sm:col-span-2">
            <label className="cv-label">Bio</label>
            <textarea
              className="cv-input min-h-[80px] resize-y"
              maxLength={500}
              placeholder="Cuenta brevemente sobre tu finca, procesos, variedades…"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            <div className="text-sm min-h-[1.25rem]">
              {err && (
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-danger)' }}>
                  <AlertCircle size={14} /> {err.message || 'No se pudo guardar'}
                </span>
              )}
              {savedAt && !m.isPending && !err && (
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-success)' }}>
                  <CheckCircle2 size={14} /> Guardado
                </span>
              )}
            </div>
            <button type="submit" disabled={m.isPending} className="cv-btn cv-btn-primary">
              {m.isPending ? <><Loader2 size={16} className="animate-spin" /> Guardando…</> : <><Save size={16} /> Guardar</>}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({
  label, icon, value, onChange,
}: { label: string; icon?: React.ReactNode; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="cv-label">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-mute)' }}>
            {icon}
          </span>
        )}
        <input
          className={`cv-input ${icon ? 'pl-9' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

/* ─────────── Fincas ─────────── */
function FarmsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['farms', 'mine'], queryFn: () => farmerApi.listFarms() });
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="cv-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Sprout size={16} /> Mis fincas</h2>
        {!showForm && (
          <button className="cv-btn cv-btn-outline cv-btn-sm" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Añadir finca
          </button>
        )}
      </div>

      {showForm && <NewFarmForm onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['farms', 'mine'] }); }} />}

      <div className="mt-4">
        {q.isLoading ? (
          <div className="space-y-2">
            {[1,2].map(i => <div key={i} className="cv-skeleton h-16" />)}
          </div>
        ) : q.data && q.data.length > 0 ? (
          <ul className="grid sm:grid-cols-2 gap-3">
            {q.data.map((f) => (
              <li key={f.id} className="cv-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold truncate">{f.nombre_finca}</div>
                  {f.is_active && <span className="cv-chip cv-chip-success">Activa</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {f.altitud_msnm != null && (
                    <span className="cv-chip"><Mountain size={12} /> {f.altitud_msnm} msnm</span>
                  )}
                  {f.tipo_suelo && (
                    <span className="cv-chip">{f.tipo_suelo}</span>
                  )}
                  {f.ph_suelo != null && (
                    <span className="cv-chip">pH {f.ph_suelo}</span>
                  )}
                </div>
                {f.microclima && (
                  <div className="mt-2 text-xs" style={{ color: 'var(--color-text-mute)' }}>
                    {f.microclima}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Sprout size={36} strokeWidth={1.5} />}
            title="Aún no has registrado fincas"
            description="Agrega tu primera finca para poder asignarla a tus análisis y lotes."
            action={
              !showForm && (
                <button className="cv-btn cv-btn-primary" onClick={() => setShowForm(true)}>
                  <Plus size={16} /> Añadir finca
                </button>
              )
            }
          />
        )}
      </div>
    </section>
  );
}

function NewFarmForm({ onDone }: { onDone: () => void }) {
  const [nombre, setNombre] = useState('');
  const [altitud, setAltitud] = useState('');
  const [tipoSuelo, setTipoSuelo] = useState('');
  const [phSuelo, setPhSuelo] = useState('');
  const [microclima, setMicroclima] = useState('');

  const m = useMutation({
    mutationFn: () => farmerApi.createFarm({
      nombreFinca: nombre.trim(),
      altitudMsnm: altitud ? Number(altitud) : undefined,
      tipoSuelo: tipoSuelo.trim() || undefined,
      phSuelo: phSuelo ? Number(phSuelo) : undefined,
      microclima: microclima.trim() || undefined,
    }),
    onSuccess: onDone,
  });

  const err = m.error instanceof ApiError ? m.error : null;
  const canSubmit = nombre.trim().length >= 2;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) m.mutate(); }}
      className="mt-4 p-4 rounded-2xl space-y-3"
      style={{ background: 'var(--color-surface-2)' }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="cv-label">Nombre de la finca *</label>
          <input className="cv-input" required minLength={2} maxLength={120}
                 value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label className="cv-label">Altitud (msnm)</label>
          <input className="cv-input" type="number" min={0} max={5000}
                 value={altitud} onChange={(e) => setAltitud(e.target.value)} />
        </div>
        <div>
          <label className="cv-label">pH del suelo</label>
          <input className="cv-input" type="number" min={3} max={10} step="0.1"
                 value={phSuelo} onChange={(e) => setPhSuelo(e.target.value)} />
        </div>
        <div>
          <label className="cv-label">Tipo de suelo</label>
          <input className="cv-input" maxLength={80} placeholder="Franco arcilloso"
                 value={tipoSuelo} onChange={(e) => setTipoSuelo(e.target.value)} />
        </div>
        <div>
          <label className="cv-label">Microclima</label>
          <input className="cv-input" maxLength={120} placeholder="Húmedo, sombra parcial"
                 value={microclima} onChange={(e) => setMicroclima(e.target.value)} />
        </div>
      </div>
      {err && (
        <div className="text-sm flex items-center gap-1.5" style={{ color: 'var(--color-danger)' }}>
          <AlertCircle size={14} /> {err.message || 'No se pudo crear la finca'}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="cv-btn cv-btn-ghost" onClick={onDone}>Cancelar</button>
        <button type="submit" disabled={m.isPending || !canSubmit} className="cv-btn cv-btn-primary">
          {m.isPending ? <><Loader2 size={16} className="animate-spin" /> Creando…</> : <><Plus size={16} /> Crear finca</>}
        </button>
      </div>
    </form>
  );
}
