import { z } from 'zod';
import { ServiceError } from '@vianoor/service-runtime';
export const policySchema = z
  .object({
    waiting_minutes: z.number().int().min(5).max(30).default(15),
    join_grace_minutes: z.number().int().min(1).max(30).default(15),
    reconnect_seconds: z.number().int().min(30).max(180).default(60),
    no_show_minutes: z.number().int().min(5).max(30).default(15),
    client_screen_share: z.boolean().default(false),
    observer: z
      .enum([
        'NEVER',
        'WITH_USER_CONSENT',
        'WITH_BOTH_CONSENT',
        'ADMIN_EMERGENCY_ONLY',
        'ALLOWED_BY_SERVICE_POLICY',
      ])
      .default('NEVER'),
    recording: z.enum(['OFF', 'BOTH_CONSENT']).default('OFF'),
    retention_days: z.number().int().min(1).max(90).default(30),
    recording_download: z.boolean().default(false),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export type BookingContext = {
  id: string;
  client_id: string;
  expert_id: string;
  status: string;
  start_at: string;
  end_at: string;
  kind: string;
  title: string;
  expert_name: string;
  call_policy?: unknown;
};
export type Session = {
  id: string;
  booking_id: string;
  client_id: string;
  expert_id: string;
  room_name: string;
  state: string;
  kind: string;
  title: string;
  expert_name: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  policy: Policy;
  end_reason: string | null;
  revision: number;
};
export const terminal = new Set([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW_USER',
  'NO_SHOW_EXPERT',
  'TECHNICAL_FAILURE',
  'INTERRUPTED',
  'TERMINATED_BY_ADMIN',
]);
export function roleFor(s: Pick<Session, 'client_id' | 'expert_id'>, account: string) {
  return account === s.client_id ? 'CLIENT' : account === s.expert_id ? 'EXPERT' : null;
}
export function assertEligible(b: BookingContext) {
  if (!['CONFIRMED', 'RESCHEDULED', 'RESCHEDULE_REQUESTED'].includes(b.status))
    throw new ServiceError(403, 'BOOKING_NOT_JOINABLE');
  if (!['VIDEO', 'AUDIO', 'TEXT'].includes(b.kind))
    throw new ServiceError(409, 'SERVICE_NOT_CALL_ENABLED');
}
export function assertWindow(s: Session, now = Date.now(), waiting = false) {
  if (terminal.has(s.state) || s.state === 'ENDING') throw new ServiceError(409, 'SESSION_ENDED');
  const start = Date.parse(s.scheduled_start) - (waiting ? s.policy.waiting_minutes * 60000 : 0),
    end = Date.parse(s.scheduled_end) + s.policy.join_grace_minutes * 60000;
  if (now < start || now >= end) throw new ServiceError(403, 'OUTSIDE_SESSION_WINDOW');
}
export function observerAllowed(
  policy: Policy,
  client: boolean,
  expert: boolean,
  emergency: boolean,
) {
  switch (policy.observer) {
    case 'NEVER':
      return false;
    case 'WITH_USER_CONSENT':
      return client;
    case 'WITH_BOTH_CONSENT':
      return client && expert;
    case 'ADMIN_EMERGENCY_ONLY':
      return emergency;
    case 'ALLOWED_BY_SERVICE_POLICY':
      return true;
  }
}
export function capabilities(kind: string, role: string, policy: Policy) {
  const participant = role === 'CLIENT' || role === 'EXPERT';
  return {
    microphone: participant && kind !== 'TEXT',
    camera: participant && kind === 'VIDEO',
    screen: participant && kind === 'VIDEO' && (role === 'EXPERT' || policy.client_screen_share),
    subscribe: true,
    publish_data: false,
  };
}
export function waitingState(s: Session, now = Date.now()) {
  if (s.state !== 'BOOKED') return s.state;
  return now < Date.parse(s.scheduled_start) - s.policy.waiting_minutes * 60000
    ? 'WAITING_FOR_START'
    : 'WAITING_ROOM_OPEN';
}
