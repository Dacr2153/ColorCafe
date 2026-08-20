# FASE 6 — Calidad, Seguridad y Observabilidad

## Estado actual (verificado)

### Seguridad

| Control                                  | Implementación                                                  |
|------------------------------------------|------------------------------------------------------------------|
| Hash de contraseñas                      | argon2id (m=64 MiB, t=3, p=4) — `src/features/auth/passwords.ts` |
| Política de fortaleza                    | ≥10 char, mayús+minús+dígito+símbolo + límite 128                |
| Resistencia a user enumeration en login  | Hash dummy + verify-timing constante                             |
| JWT                                      | RS256, llaves separadas, issuer/audience validados               |
| Refresh tokens                           | Rotación + revocación por sesión                                 |
| Rate limit                               | Token bucket por IP+ruta — `src/core/middleware/ratelimit.ts`    |
| CORS                                     | `credentials: true`, origen explícito en producción              |
| Headers                                  | `helmet` activo, CSP gestionada por Nginx en prod                |
| SQL injection                            | Sólo `pg.query(text, params)` parametrizado, sin string concat   |
| XSS en API                               | Respuestas JSON; sanitización dejada al frontend                 |
| Subida de archivos                       | `multer` memory + `file-type` por magic-bytes (no fiamos del MIME del navegador) |
| Tamaño máximo JSON                       | 1 MiB                                                            |
| Trust proxy                              | `app.set('trust proxy', 1)` para X-Forwarded                     |

### Observabilidad

| Aspecto             | Implementación                                                |
|---------------------|---------------------------------------------------------------|
| Logs estructurados  | `pino` con `requestId` correlacionable                        |
| Access log          | `pino-http` con duración, status, ruta                        |
| Métricas Prometheus | `/metrics` (counters básicos por feature)                     |
| Healthchecks        | `/health` con probes a DB, cache y storage                    |
| Trazas              | (pendiente OpenTelemetry — ver roadmap)                       |

### Calidad

| Aspecto         | Implementación                                                    |
|-----------------|-------------------------------------------------------------------|
| TypeScript      | `strict: true`, `noUncheckedIndexedAccess: true`                  |
| Lint            | ESLint con reglas TS recomendadas                                 |
| Tests unitarios | `vitest` — máquina de estados de órdenes + hashing de contraseñas |
| Tests E2E       | (pendiente Playwright)                                            |

## Cómo correr

```bash
cd Cereza/Backend
npm run typecheck    # tsc --noEmit
npm run lint
npm test             # vitest run
```

## Política de Content Security Policy (Nginx)

```nginx
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self' data:;
  connect-src 'self' https: wss:;
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;
```

`'unsafe-inline'` en `style-src` es necesario por las CSS variables inline que
usa Recharts; idealmente se reemplaza por `'nonce-…'` cuando hagamos SSR.

## Auditoría OWASP Top 10 (2021)

| ID    | Categoría                                  | Mitigación                              |
|-------|--------------------------------------------|------------------------------------------|
| A01   | Broken Access Control                      | RBAC + middleware `requireRole` + topic authorizers WS |
| A02   | Cryptographic Failures                     | argon2id + JWT RS256 + TLS terminado en Nginx |
| A03   | Injection                                  | SQL parametrizado + validación de entrada |
| A04   | Insecure Design                            | Vertical slices + máquina de estados de órdenes |
| A05   | Security Misconfiguration                  | helmet + CSP + `x-powered-by` deshabilitado |
| A06   | Vulnerable Components                      | `npm audit` en CI (pendiente automatizar) |
| A07   | Identification & Authentication            | argon2 + rate limit login + refresh con revocación |
| A08   | Software & Data Integrity                  | Imágenes Docker con tag inmutable + cosign (pendiente) |
| A09   | Security Logging & Monitoring              | pino + access log + /metrics                |
| A10   | SSRF                                       | Las URLs salientes (Ollama) están en allowlist por env |

## Pendientes honestos

- OpenTelemetry tracing → backlog
- Playwright E2E → backlog
- `npm audit` en CI pipeline → backlog
- Firma de imágenes Docker (cosign) → backlog
