import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
export const traceContext = new AsyncLocalStorage<{ traceId: string; traceparent: string }>();
export function newTrace(parent: unknown) {
  const match =
    typeof parent === 'string'
      ? /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(parent)
      : null;
  const traceId =
    match && match[1] !== '0'.repeat(32) && match[2] !== '0'.repeat(16)
      ? match[1]!
      : randomBytes(16).toString('hex');
  return { traceId, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` };
}
export const currentTraceId = () =>
  traceContext.getStore()?.traceId ?? randomBytes(16).toString('hex');
