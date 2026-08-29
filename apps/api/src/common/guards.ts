import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { INGEST_TOKEN_HEADER } from '@ai-footprint/shared';
import { Forbidden } from './errors';
import { RuntimeService } from './runtime.service';

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The API binds to loopback, but a page in the user's browser can still reach it. Rejecting
 * any request that carries a foreign Origin closes that hole and defeats DNS rebinding,
 * where a hostile name resolves to 127.0.0.1 (brief §34).
 */
@Injectable()
export class LocalOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    if (origin) {
      const hostname = hostnameOf(origin);
      if (!hostname || !ALLOWED_HOSTS.has(hostname)) {
        throw new Forbidden('Cross-origin requests are not accepted by AI Footprint.');
      }
    }

    const hostHeader = request.headers.host;
    if (hostHeader) {
      const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase();
      if (!ALLOWED_HOSTS.has(hostname)) {
        throw new Forbidden('AI Footprint only serves requests addressed to localhost.');
      }
    }

    return true;
  }
}

/** Ingestion is the only write path a foreign process could reach, so it needs the token. */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(private readonly runtime: RuntimeService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.runtime.ingestToken;
    if (!expected) return true;

    const provided = request.headers[INGEST_TOKEN_HEADER];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (value !== expected) {
      throw new Forbidden('This request did not carry a valid AI Footprint ingest token.');
    }
    return true;
  }
}
