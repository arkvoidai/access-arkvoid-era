import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEnvFromProcess, handleSession } from '../server/chatHandler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'unavailable' }));
    return;
  }

  const result = await handleSession({}, getEnvFromProcess());
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
