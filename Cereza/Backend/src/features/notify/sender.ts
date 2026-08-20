/**
 * notify/sender.ts — Interfaz Sender + implementaciones LogSender / ResendSender.
 *
 * Patrón FinalStore: si RESEND_API_KEY está vacío usamos LogSender (escribe a logs
 * REALES — no simula, los emails quedan archivados en logs estructurados que pueden
 * ser auditados). En producción se inyecta ResendSender vía main.ts.
 */
import type { Logger } from '../../core/logger.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** HTML body. */
  html: string;
  /** Plain-text alternativo. */
  text?: string;
  tag?: string;
}

export interface Sender {
  send(email: OutgoingEmail): Promise<{ id: string; provider: string }>;
  name(): string;
}

export class LogSender implements Sender {
  constructor(private log: Logger) {}
  name(): string { return 'log'; }
  async send(email: OutgoingEmail): Promise<{ id: string; provider: string }> {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.log.info({
      provider: 'log',
      messageId: id,
      to: email.to,
      subject: email.subject,
      tag: email.tag,
      bodyPreview: email.text?.slice(0, 200) ?? email.html.replace(/<[^>]+>/g, ' ').slice(0, 200),
    }, 'email_sent_via_log');
    return { id, provider: 'log' };
  }
}

export class ResendSender implements Sender {
  constructor(private apiKey: string, private from: string, private log: Logger) {}
  name(): string { return 'resend'; }
  async send(email: OutgoingEmail): Promise<{ id: string; provider: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: email.tag ? [{ name: 'tag', value: email.tag }] : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error({ status: res.status, body: body.slice(0, 500) }, 'resend_error');
      throw new Error(`resend_failed_${res.status}`);
    }
    const data = await res.json() as { id?: string };
    return { id: data.id ?? 'unknown', provider: 'resend' };
  }
}
