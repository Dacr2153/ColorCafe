/**
 * config.ts — Carga y valida toda la configuración desde variables de entorno.
 * Falla rápido si falta alguna variable crítica (fail-fast principle).
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().positive().default(3001),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  databaseUrl: z.string().url().or(z.string().startsWith('postgres')),
  redisUrl: z.string().url().or(z.string().startsWith('redis')),

  jwt: z.object({
    privateKey: z.string().min(1),
    publicKey: z.string().min(1),
    accessExpires: z.string().default('15m'),
    refreshExpires: z.string().default('7d'),
    issuer: z.string().default('cafevision'),
  }),

  minio: z.object({
    endpoint: z.string().min(1),
    port: z.coerce.number().int().positive().default(9000),
    useSSL: z.string().transform((v) => v === 'true' || v === '1').default('false'),
    accessKey: z.string().min(1),
    secretKey: z.string().min(8),
    buckets: z.object({
      analyses: z.string().default('cafe-analyses'),
      documents: z.string().default('cafe-documents'),
      marketplace: z.string().default('cafe-marketplace'),
    }),
  }),

  ollama: z.object({
    baseUrl: z.string().url().default('http://localhost:11434'),
    model: z.string().default('mistral:7b-instruct'),
    timeoutMs: z.coerce.number().int().positive().default(60_000),
  }),

  pythonAnalysisUrl: z.string().url().default('http://localhost:8000'),

  email: z.object({
    resendApiKey: z.string().optional(),
    from: z.string().email().default('noreply@cafevision.local'),
  }),

  skipMigrations: z.string().transform((v) => v === 'true' || v === '1').default('false'),
});

export type AppConfig = z.infer<typeof configSchema>;

function readKeyFile(path: string | undefined, label: string): string {
  if (!path) throw new Error(`Missing required env: ${label}`);
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read ${label} from "${path}": ${(e as Error).message}`);
  }
}

export function loadConfig(): AppConfig {
  const raw = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL,
    databaseUrl: process.env.DATABASE_URL ?? '',
    redisUrl: process.env.REDIS_URL ?? '',
    jwt: {
      privateKey: readKeyFile(process.env.JWT_PRIVATE_KEY_PATH, 'JWT_PRIVATE_KEY_PATH'),
      publicKey: readKeyFile(process.env.JWT_PUBLIC_KEY_PATH, 'JWT_PUBLIC_KEY_PATH'),
      accessExpires: process.env.JWT_ACCESS_EXPIRES,
      refreshExpires: process.env.JWT_REFRESH_EXPIRES,
      issuer: process.env.JWT_ISSUER,
    },
    minio: {
      endpoint: process.env.MINIO_ENDPOINT ?? '',
      port: process.env.MINIO_PORT,
      useSSL: process.env.MINIO_USE_SSL,
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
      buckets: {
        analyses: process.env.MINIO_BUCKET_ANALYSES,
        documents: process.env.MINIO_BUCKET_DOCUMENTS,
        marketplace: process.env.MINIO_BUCKET_MARKETPLACE,
      },
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL,
      timeoutMs: process.env.OLLAMA_TIMEOUT_MS,
    },
    pythonAnalysisUrl: process.env.PYTHON_ANALYSIS_URL,
    email: {
      resendApiKey: process.env.RESEND_API_KEY || undefined,
      from: process.env.EMAIL_FROM,
    },
    skipMigrations: process.env.SKIP_MIGRATIONS,
  };

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
