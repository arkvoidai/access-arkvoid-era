import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEnvFromProcess, handleHealth } from '../server/chatHandler.ts';

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const result = await handleHealth(getEnvFromProcess());
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
