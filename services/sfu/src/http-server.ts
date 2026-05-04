/**
 * Tiny HTTP server. Three endpoints, all read-only, all public.
 *
 *   GET /          — JSON service description (mirrors kind 31313).
 *   GET /healthz   — 200 OK with uptime; 503 if shutting down.
 *   GET /rooms     — sanitized list of active rooms (channel id, count, status).
 *
 * This is what the Cloudflare tunnel exposes. The tunnel is cosmetic —
 * call control happens over Nostr — but it gives operators a public
 * URL for monitoring and clients a verifiable identity endpoint.
 *
 * No auth on these endpoints. They expose nothing the relay doesn't
 * already serve via kind 31313 / 31314.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

import { createLogger } from './log.js';
import type { Config } from './config.js';
import type { RoomManager } from './room-manager.js';

const log = createLogger('http');

export interface HttpServerDeps {
  cfg: Config;
  sfuPubkey: string;
  rooms: RoomManager;
  bootedAt: number;
}

export class HttpServer {
  private server: Server | null = null;
  private shuttingDown = false;

  constructor(private readonly deps: HttpServerDeps) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.on('error', (err) => {
        log.error('http server error', { err: (err as Error).message });
        reject(err);
      });
      server.listen(this.deps.cfg.httpPort, () => {
        log.info('http server listening', { port: this.deps.cfg.httpPort });
        resolve();
      });
      this.server = server;
    });
  }

  setShuttingDown(): void {
    this.shuttingDown = true;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'method not allowed' });
    }

    if (url === '/' || url.startsWith('/?')) {
      return this.handleRoot(res);
    }
    if (url === '/healthz' || url.startsWith('/healthz?')) {
      return this.handleHealth(res);
    }
    if (url === '/rooms' || url.startsWith('/rooms?')) {
      return this.handleRooms(res);
    }
    json(res, 404, { error: 'not found' });
  }

  private handleRoot(res: ServerResponse): void {
    json(res, 200, {
      service: 'obelisk-sfu',
      version: '0.1.0',
      pubkey: this.deps.sfuPubkey,
      url: this.deps.cfg.publicUrl,
      relays: this.deps.cfg.relays,
      cap: this.deps.cfg.maxParticipantsPerRoom,
      maxRooms: this.deps.cfg.maxRooms,
      codecs: ['opus', 'vp9', 'h264'],
      operator: this.deps.cfg.operatorPubkey ?? this.deps.sfuPubkey,
      region: this.deps.cfg.region,
      bootedAt: this.deps.bootedAt,
    });
  }

  private handleHealth(res: ServerResponse): void {
    if (this.shuttingDown) {
      return json(res, 503, { status: 'draining' });
    }
    json(res, 200, {
      status: 'ok',
      uptime: Math.floor(Date.now() / 1000) - this.deps.bootedAt,
      activeRooms: this.deps.rooms.size(),
    });
  }

  private handleRooms(res: ServerResponse): void {
    // Public-safe view: don't leak participant pubkey list, just count.
    const sanitized = this.deps.rooms.list().map((r) => ({
      channelId: r.channelId,
      status: r.status,
      participants: r.participants.length,
      startedAt: r.startedAt,
      host: r.hostPubkey,
    }));
    json(res, 200, { rooms: sanitized });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}
