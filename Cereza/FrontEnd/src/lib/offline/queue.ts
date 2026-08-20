/**
 * lib/offline/queue.ts — Cola persistente de análisis pendientes.
 *
 * Cuando el usuario captura una foto sin conexión, el blob se guarda en
 * IndexedDB con su metadata. Al recuperar conexión, `flushQueue` los envía
 * uno a uno al backend en orden cronológico.
 *
 * Política honesta:
 *  - Cada item pendiente está marcado claramente como "pendiente de subida"
 *    y NUNCA se le inventan resultados.
 *  - Si falla la subida, queda en la cola con `lastError` para que la UI
 *    informe; jamás se descarta silenciosamente.
 *
 * Política de reintento:
 *  - Máximo 5 intentos por item.
 *  - Reintentos con backoff exponencial gestionados desde fuera (al evento online).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'cafevision.offline.v1';
const STORE = 'pending_analyses';

export interface PendingAnalysis {
  id: string;                 // uuid local (no es el id del backend)
  createdAt: number;          // epoch ms cuando se encoló
  farmId: string;
  grainType: 'cereza' | 'pergamino' | 'trilla';
  sampleWeightG: number;
  captureConditions?: Record<string, unknown>;
  filename: string;
  mime: string;
  blob: Blob;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: number;
}

interface Schema extends DBSchema {
  pending_analyses: {
    key: string;
    value: PendingAnalysis;
    indexes: { byCreatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byCreatedAt', 'createdAt');
      },
    });
  }
  return dbPromise;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const offlineQueue = {
  async enqueue(input: Omit<PendingAnalysis, 'id' | 'createdAt' | 'attempts'>): Promise<PendingAnalysis> {
    const db = await getDb();
    const item: PendingAnalysis = { ...input, id: uuid(), createdAt: Date.now(), attempts: 0 };
    await db.put(STORE, item);
    return item;
  },

  async list(): Promise<PendingAnalysis[]> {
    const db = await getDb();
    return db.getAllFromIndex(STORE, 'byCreatedAt');
  },

  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(STORE, id);
  },

  async markFailed(id: string, error: string): Promise<void> {
    const db = await getDb();
    const item = await db.get(STORE, id);
    if (!item) return;
    item.attempts += 1;
    item.lastError = error;
    item.lastAttemptAt = Date.now();
    await db.put(STORE, item);
  },

  async clearAll(): Promise<void> {
    const db = await getDb();
    await db.clear(STORE);
  },
};

/**
 * Drena la cola enviando cada item al uploader provisto. El uploader debe:
 *   - Devolver el id del análisis backend en caso de éxito.
 *   - Lanzar error en caso de fallo (la cola actualiza attempts/lastError).
 *
 * Detiene el flush en cuanto un item falla de forma transitoria (mantiene
 * orden cronológico). Items con >= maxAttempts quedan en cola para revisión
 * manual del usuario; no se borran automáticamente.
 */
export async function flushQueue(
  upload: (item: PendingAnalysis) => Promise<string>,
  opts: { maxAttempts?: number } = {},
): Promise<{ uploaded: number; pending: number }> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const items = await offlineQueue.list();
  let uploaded = 0;
  for (const item of items) {
    if (item.attempts >= maxAttempts) continue;
    try {
      await upload(item);
      await offlineQueue.remove(item.id);
      uploaded += 1;
    } catch (e) {
      await offlineQueue.markFailed(item.id, (e as Error).message);
      // Si fue un 4xx de validación, no tiene sentido reintentar el resto en orden;
      // pero como no diferenciamos, paramos para evitar martillear al backend.
      break;
    }
  }
  const remaining = await offlineQueue.list();
  return { uploaded, pending: remaining.length };
}
