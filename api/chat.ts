import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEnvFromProcess, handleChat } from '../server/chatHandler.ts';

interface VercelLikeRequest extends IncomingMessage {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (data: unknown) => void;
}

async function readBody(req: VercelLikeRequest): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'unavailable' }));
    return;
  }

  const body = await readBody(req);
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || '127.0.0.1';

  const result = await handleChat({ body, ip }, getEnvFromProcess());
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
