/**
 * storage.ts — Cliente MinIO (S3-compatible).
 *
 * Responsabilidades:
 *  - putObject con metadata (sha256, content-type, uploaded-by)
 *  - getObject como stream
 *  - presignedGetObject para servir imágenes/docs vía URL temporal
 *  - removeObject
 *
 * NO realiza transformaciones de imagen (eso es responsabilidad de la feature analysis).
 */
import { Client as MinioClient } from 'minio';
import { Readable } from 'node:stream';
import type { Logger } from './logger.js';

export interface PutResult {
  bucket: string;
  key: string;
  etag: string;
  versionId?: string;
}

export interface StorageBuckets {
  analyses: string;
  documents: string;
  marketplace: string;
}

export class Storage {
  private client: MinioClient;

  constructor(
    cfg: { endpoint: string; port: number; useSSL: boolean; accessKey: string; secretKey: string },
    public readonly buckets: StorageBuckets,
    private log: Logger,
  ) {
    this.client = new MinioClient({
      endPoint: cfg.endpoint,
      port: cfg.port,
      useSSL: cfg.useSSL,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
    });
  }

  async ensureBuckets(): Promise<void> {
    for (const b of Object.values(this.buckets)) {
      const exists = await this.client.bucketExists(b).catch(() => false);
      if (!exists) {
        await this.client.makeBucket(b, 'us-east-1');
        this.log.info({ bucket: b }, 'minio_bucket_created');
      }
    }
  }

  async put(
    bucket: string,
    key: string,
    body: Buffer | Readable,
    size: number,
    metadata: Record<string, string>,
  ): Promise<PutResult> {
    const res = await this.client.putObject(bucket, key, body, size, metadata);
    return { bucket, key, etag: res.etag, versionId: res.versionId ?? undefined };
  }

  async getStream(bucket: string, key: string): Promise<Readable> {
    return this.client.getObject(bucket, key);
  }

  async statObject(bucket: string, key: string) {
    return this.client.statObject(bucket, key);
  }

  async presignedGet(bucket: string, key: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySeconds);
  }

  async remove(bucket: string, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const t0 = Date.now();
    try {
      await this.client.listBuckets();
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
    }
  }
}
