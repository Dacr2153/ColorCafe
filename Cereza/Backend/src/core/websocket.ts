/**
 * websocket.ts — WebSocket Hub (patrón Mediator, equivalente a FinalStore/websocket/hub.go).
 *
 * Múltiples clientes pueden suscribirse a "topics" (ej: `analysis:{id}` para
 * recibir progreso en vivo). El Hub mantiene mapping topic → set<client>.
 *
 * Mensajes salientes: JSON `{ topic, type, payload }`.
 * Mensajes entrantes del cliente: `{ action: 'subscribe'|'unsubscribe', topic }`.
 *
 * Autenticación: el cliente envía `?token=<JWT>` en query — validado en upgrade.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { URL } from 'node:url';
import type { Logger } from './logger.js';

export interface AuthenticatedClient {
  userId: string;
  role: string;
}

export type TokenVerifier = (token: string) => Promise<AuthenticatedClient | null>;

export type TopicAuthorizer = (auth: AuthenticatedClient, topic: string) => Promise<boolean> | boolean;

interface HubMessage {
  topic: string;
  type: string;
  payload?: unknown;
}

export class WebSocketHub {
  private wss: WebSocketServer;
  private topics = new Map<string, Set<WebSocket>>();
  private clientInfo = new WeakMap<WebSocket, AuthenticatedClient & { subscriptions: Set<string> }>();
  /** Autorizadores registrables por prefijo (ej: 'order:'). El primero que matchee decide. */
  private authorizers: Array<{ prefix: string; fn: TopicAuthorizer }> = [];

  constructor(private log: Logger, private verifyToken: TokenVerifier) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Permite a una feature autorizar topics personalizados (ej: order:{id}). */
  registerTopicAuthorizer(prefix: string, fn: TopicAuthorizer): void {
    this.authorizers.push({ prefix, fn });
  }

  /** Engancha el upgrade HTTP del servidor existente al WS server. */
  attach(server: HttpServer, pathPrefix = '/ws'): void {
    server.on('upgrade', async (req, socket, head) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(pathPrefix)) {
          socket.destroy();
          return;
        }
        const token = url.searchParams.get('token');
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        const auth = await this.verifyToken(token);
        if (!auth) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.onConnection(ws, auth, req);
        });
      } catch (e) {
        this.log.error({ err: (e as Error).message }, 'ws_upgrade_error');
        socket.destroy();
      }
    });
  }

  private onConnection(ws: WebSocket, auth: AuthenticatedClient, _req: IncomingMessage): void {
    this.clientInfo.set(ws, { ...auth, subscriptions: new Set() });
    this.log.info({ userId: auth.userId }, 'ws_connected');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { action?: string; topic?: string };
        if (!msg.action || !msg.topic) return;
        if (msg.action === 'subscribe') void this.subscribe(ws, msg.topic);
        else if (msg.action === 'unsubscribe') this.unsubscribe(ws, msg.topic);
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: 'invalid_message' }));
      }
    });

    ws.on('close', () => {
      const info = this.clientInfo.get(ws);
      if (info) {
        for (const t of info.subscriptions) this.unsubscribe(ws, t);
      }
      this.log.info({ userId: auth.userId }, 'ws_disconnected');
    });

    ws.on('error', (err) => this.log.warn({ err: err.message }, 'ws_client_error'));
  }

  private async isAuthorizedForTopic(auth: AuthenticatedClient, topic: string): Promise<boolean> {
    // Topics personales: `user:{userId}` solo el dueño
    if (topic.startsWith('user:')) return topic === `user:${auth.userId}`;
    // Topics admin/broadcast: solo admin
    if (topic.startsWith('admin:') || topic === 'broadcast') return auth.role === 'admin';
    // Autorizadores registrados por features (ej: order:{id} → consulta DB)
    for (const a of this.authorizers) {
      if (topic.startsWith(a.prefix)) {
        try { return await a.fn(auth, topic); }
        catch (e) { this.log.warn({ err: (e as Error).message, topic }, 'topic_authorizer_error'); return false; }
      }
    }
    // Topics de analysis: `analysis:{id}` — autorización en lado publish
    if (topic.startsWith('analysis:')) return true;
    return false;
  }

  async subscribe(ws: WebSocket, topic: string): Promise<void> {
    const info = this.clientInfo.get(ws);
    if (!info) return;
    if (!(await this.isAuthorizedForTopic(info, topic))) {
      ws.send(JSON.stringify({ type: 'error', topic, payload: 'forbidden' }));
      return;
    }
    let set = this.topics.get(topic);
    if (!set) { set = new Set(); this.topics.set(topic, set); }
    set.add(ws);
    info.subscriptions.add(topic);
  }

  unsubscribe(ws: WebSocket, topic: string): void {
    this.topics.get(topic)?.delete(ws);
    if (this.topics.get(topic)?.size === 0) this.topics.delete(topic);
    this.clientInfo.get(ws)?.subscriptions.delete(topic);
  }

  /** Publica a todos los clientes suscritos al topic. */
  publish(topic: string, type: string, payload?: unknown): void {
    const subs = this.topics.get(topic);
    if (!subs || subs.size === 0) return;
    const msg: HubMessage = { topic, type, payload };
    const data = JSON.stringify(msg);
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  async close(): Promise<void> {
    for (const ws of this.wss.clients) {
      try { ws.close(1001, 'server_shutdown'); } catch { /* ignore */ }
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
