/**
 * features/content/ollama.ts — Cliente para Ollama (modelo Mistral).
 *
 * Solo expone `generate(prompt, options)`. Sin streaming en este MVP.
 * Si el servicio Ollama no responde, lanza error — NO fabricamos texto.
 */
import { request } from 'undici';
import type { Logger } from '../../core/logger.js';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface GenerateOptions {
  /** Sobreescribe el modelo del config (ej: para generación más rápida). */
  model?: string;
  /** Temperatura 0..2. */
  temperature?: number;
  /** Tope de tokens predichos. */
  numPredict?: number;
  /** Prompt de sistema (instrucción de rol). */
  system?: string;
}

export interface OllamaResponse {
  text: string;
  model: string;
  evalCount: number;
  durationMs: number;
}

export class OllamaClient {
  constructor(private cfg: OllamaConfig, private log: Logger) {}

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<OllamaResponse> {
    const url = this.cfg.baseUrl.replace(/\/$/, '') + '/api/generate';
    const body = {
      model: opts.model ?? this.cfg.model,
      prompt,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.4,
        num_predict: opts.numPredict ?? 512,
      },
      ...(opts.system ? { system: opts.system } : {}),
    };
    const t0 = Date.now();
    const res = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      bodyTimeout: this.cfg.timeoutMs,
      headersTimeout: this.cfg.timeoutMs,
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`ollama_error status=${res.statusCode} body=${text.slice(0, 300)}`);
    }
    let parsed: { response?: string; model?: string; eval_count?: number };
    try { parsed = JSON.parse(text); } catch { throw new Error('ollama_invalid_json'); }
    if (typeof parsed.response !== 'string') throw new Error('ollama_missing_response');
    const duration = Date.now() - t0;
    this.log.debug({ model: body.model, duration_ms: duration, evalCount: parsed.eval_count }, 'ollama_generated');
    return {
      text: parsed.response,
      model: parsed.model ?? body.model,
      evalCount: parsed.eval_count ?? 0,
      durationMs: duration,
    };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const t0 = Date.now();
    try {
      const res = await request(this.cfg.baseUrl.replace(/\/$/, '') + '/api/tags', {
        method: 'GET',
        headersTimeout: 5000,
        bodyTimeout: 5000,
      });
      await res.body.dump();
      return { ok: res.statusCode === 200, latency_ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
    }
  }
}
