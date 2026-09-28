import { AccessToken, RoomServiceClient, WebhookReceiver, TrackSource } from 'livekit-server-sdk';
import { ServiceError } from '@vianoor/service-runtime';
import { capabilities, type Session } from './policy.js';
export function livekitConfig() {
  const url = process.env.LIVEKIT_HTTP_URL,
    publicUrl = process.env.LIVEKIT_PUBLIC_URL,
    key = process.env.LIVEKIT_API_KEY,
    secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !publicUrl || !key || !secret || secret.length < 32)
    throw new ServiceError(503, 'MEDIA_NOT_CONFIGURED');
  if (new URL(publicUrl).protocol !== 'wss:' && process.env.AUTH_DEVELOPMENT !== '1')
    throw new ServiceError(503, 'MEDIA_TLS_REQUIRED');
  return { url, publicUrl, key, secret };
}
export function rooms() {
  const c = livekitConfig();
  return new RoomServiceClient(c.url, c.key, c.secret);
}
export function receiver() {
  const c = livekitConfig();
  return new WebhookReceiver(c.key, c.secret);
}
export async function issueToken(s: Session, identity: string, role: string) {
  const c = livekitConfig(),
    p = capabilities(s.kind, role, s.policy),
    sources: TrackSource[] = [];
  if (p.microphone) sources.push(TrackSource.MICROPHONE);
  if (p.camera) sources.push(TrackSource.CAMERA);
  if (p.screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  const token = new AccessToken(c.key, c.secret, {
    identity,
    ttl: 90,
    name: role,
    metadata: JSON.stringify({ role, session_id: s.id }),
  });
  token.addGrant({
    room: s.room_name,
    roomJoin: true,
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    hidden: false,
  });
  return {
    token: await token.toJwt(),
    url: c.publicUrl,
    expires_in: 90,
    capabilities: p,
    identity,
  };
}
