export function readRuntimeConfig(defaultPort: number, env: NodeJS.ProcessEnv = process.env) {
  const raw = env.PORT ?? String(defaultPort);
  if (!/^\d+$/.test(raw)) throw new Error('PORT must be an integer');
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT outside 1..65535');
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0', '::1'].includes(host)) throw new Error('Unsupported HOST');
  return { port, host };
}
