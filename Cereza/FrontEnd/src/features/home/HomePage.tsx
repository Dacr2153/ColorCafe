/**
 * features/home/HomePage.tsx — Pantalla raíz.
 *
 * Si el usuario está autenticado, muestra Dashboard con datos reales.
 * Si no, muestra Landing con value props honestos (sin métricas fake).
 */
import { Link } from 'react-router-dom';
import {
  Camera, BarChart3, Store, ArrowRight, ShieldCheck, Sparkles, Zap, Database,
} from 'lucide-react';
import { useAuthStore, selectIsAuthenticated } from '../../lib/auth/store';
import { Dashboard } from './Dashboard';

export function HomePage() {
  const isAuth = useAuthStore(selectIsAuthenticated);
  return isAuth ? <Dashboard /> : <Landing />;
}

function Landing() {
  return (
    <>
      {/* HERO */}
      <section className="cv-hero-bg">
        <div className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 py-12 sm:py-20 text-center">
          <span className="cv-chip cv-chip-accent mb-5">
            <Sparkles size={14} /> Datos reales, sin valores inventados
          </span>
          <h1 className="text-3xl sm:text-5xl font-bold leading-tight tracking-tight"
              style={{ color: 'var(--color-text)' }}>
            Análisis profesional del café<br className="hidden sm:block"/> que produces.
          </h1>
          <p className="mt-5 max-w-xl mx-auto text-base sm:text-lg"
             style={{ color: 'var(--color-text-soft)' }}>
            Sube una foto de tu muestra y recibe un análisis trazable: defectos,
            color, calidad. Conecta con compradores que valoran lotes verificados.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row justify-center gap-3">
            <Link to="/register" className="cv-btn cv-btn-primary cv-btn-lg">
              Crear cuenta gratis <ArrowRight size={18} />
            </Link>
            <Link to="/marketplace" className="cv-btn cv-btn-outline cv-btn-lg">
              Ver marketplace
            </Link>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            icon={<Camera />}
            title="Captura desde el campo"
            desc="Toma una foto con tu celular. Validamos calidad de imagen antes de procesar."
          />
          <FeatureCard
            icon={<Database />}
            title="Análisis trazable"
            desc="Cada análisis queda registrado con su versión del algoritmo. Reproducible."
          />
          <FeatureCard
            icon={<BarChart3 />}
            title="Métricas honestas"
            desc="Tu evolución por finca y temporada. Si no hay datos, no inventamos cifras."
          />
          <FeatureCard
            icon={<Store />}
            title="Marketplace verificado"
            desc="Publica lotes con tu score real. Los compradores ven datos confirmados."
          />
          <FeatureCard
            icon={<ShieldCheck />}
            title="Tu información, tuya"
            desc="No vendemos datos. Cifrado en tránsito y reposo. Cumplimos buenas prácticas."
          />
          <FeatureCard
            icon={<Zap />}
            title="Funciona sin red"
            desc="Captura en el campo aunque pierdas señal. Se envía al recuperar conexión."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 sm:px-6 pb-12 sm:pb-16">
        <div className="max-w-[var(--max-w)] mx-auto cv-card p-6 sm:p-10 text-center"
             style={{ background: 'var(--color-primary)', color: '#fff', borderColor: 'transparent' }}>
          <h2 className="text-2xl sm:text-3xl font-bold">¿Listo para empezar?</h2>
          <p className="mt-2 opacity-90">
            Crea una cuenta y haz tu primer análisis hoy.
          </p>
          <Link to="/register" className="cv-btn cv-btn-lg mt-5"
                style={{ background: '#fff', color: 'var(--color-primary)' }}>
            Crear mi cuenta <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <article className="cv-card cv-card-hover p-5">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
           style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
        {icon}
      </div>
      <h3 className="font-semibold text-base">{title}</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--color-text-mute)' }}>{desc}</p>
    </article>
  );
}
