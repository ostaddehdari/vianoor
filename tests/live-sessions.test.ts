import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TokenVerifier, AccessToken } from 'livekit-server-sdk';
import {
  policySchema,
  roleFor,
  assertEligible,
  assertWindow,
  observerAllowed,
  capabilities,
  waitingState,
  type Session,
} from '../services/media-service/src/policy.js';
import { issueToken, receiver } from '../services/media-service/src/livekit.js';
import { sessionsCopy } from '../packages/ui/src/sessions-copy.js';
const now = Date.UTC(2026, 9, 1, 12),
  policy = policySchema.parse({}),
  session: Session = {
    id: randomUUID(),
    booking_id: randomUUID(),
    client_id: randomUUID(),
    expert_id: randomUUID(),
    room_name: 'vn_' + randomUUID().replaceAll('-', ''),
    state: 'JOINABLE',
    kind: 'VIDEO',
    title: 'Synthetic',
    expert_name: 'Synthetic',
    scheduled_start: new Date(now).toISOString(),
    scheduled_end: new Date(now + 3600000).toISOString(),
    actual_started_at: null,
    actual_ended_at: null,
    policy,
    end_reason: null,
    revision: 1,
  };
test('session ownership has no admin-by-default role', () => {
  assert.equal(roleFor(session, session.client_id), 'CLIENT');
  assert.equal(roleFor(session, session.expert_id), 'EXPERT');
  assert.equal(roleFor(session, randomUUID()), null);
});
test('waiting and call admission windows enforce exact boundaries and terminal states', () => {
  assert.doesNotThrow(() => assertWindow(session, now - 15 * 60000, true));
  assert.throws(() => assertWindow(session, now - 15 * 60000 - 1, true));
  assert.throws(() => assertWindow(session, now - 1));
  assert.doesNotThrow(() => assertWindow(session, now));
  assert.throws(() => assertWindow(session, now + 75 * 60000));
  for (const state of [
    'ENDING',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW_USER',
    'NO_SHOW_EXPERT',
    'INTERRUPTED',
    'TECHNICAL_FAILURE',
    'TERMINATED_BY_ADMIN',
  ])
    assert.throws(() => assertWindow({ ...session, state }, now));
  assert.equal(
    waitingState({ ...session, state: 'BOOKED' }, now - 16 * 60000),
    'WAITING_FOR_START',
  );
  assert.equal(
    waitingState({ ...session, state: 'BOOKED' }, now - 14 * 60000),
    'WAITING_ROOM_OPEN',
  );
});
test('cancelled unpaid expired or unsupported bookings cannot open a call', () => {
  const b = {
    ...session,
    id: session.booking_id,
    start_at: session.scheduled_start,
    end_at: session.scheduled_end,
    status: 'CONFIRMED',
  };
  assert.doesNotThrow(() => assertEligible(b));
  for (const status of ['HELD', 'BOOKING_PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'COMPLETED'])
    assert.throws(() => assertEligible({ ...b, status }));
  assert.throws(() => assertEligible({ ...b, kind: 'IN_PERSON' }));
});
test('all observer policies require their exact consent condition', () => {
  assert.equal(observerAllowed(policy, true, true, true), false);
  assert.equal(
    observerAllowed({ ...policy, observer: 'WITH_USER_CONSENT' }, false, true, false),
    false,
  );
  assert.equal(
    observerAllowed({ ...policy, observer: 'WITH_USER_CONSENT' }, true, false, false),
    true,
  );
  assert.equal(
    observerAllowed({ ...policy, observer: 'WITH_BOTH_CONSENT' }, true, false, true),
    false,
  );
  assert.equal(
    observerAllowed({ ...policy, observer: 'WITH_BOTH_CONSENT' }, true, true, false),
    true,
  );
  assert.equal(
    observerAllowed({ ...policy, observer: 'ADMIN_EMERGENCY_ONLY' }, true, true, false),
    false,
  );
  assert.equal(
    observerAllowed({ ...policy, observer: 'ADMIN_EMERGENCY_ONLY' }, false, false, true),
    true,
  );
  assert.equal(policy.recording, 'OFF');
});
test('media source grants distinguish audio video text client and observer', () => {
  assert.equal(capabilities('AUDIO', 'EXPERT', policy).camera, false);
  assert.equal(capabilities('VIDEO', 'CLIENT', policy).screen, false);
  assert.equal(capabilities('VIDEO', 'EXPERT', policy).screen, true);
  for (const kind of ['AUDIO', 'VIDEO', 'TEXT']) {
    const c = capabilities(kind, 'OBSERVER', policy);
    assert.equal(c.microphone || c.camera || c.screen || c.publish_data, false);
  }
  assert.equal(capabilities('TEXT', 'EXPERT', policy).microphone, false);
});
test('fa/en live-session translation keys are complete', () =>
  assert.deepEqual(Object.keys(sessionsCopy.fa!).sort(), Object.keys(sessionsCopy.en!).sort()));
test('300 simultaneous signed tokens stay scoped; observer never gets publish or room admin and webhooks require matching payload signature', async () => {
  const names = ['LIVEKIT_HTTP_URL', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    old = names.map((n) => process.env[n]);
  Object.assign(process.env, {
    LIVEKIT_HTTP_URL: 'http://127.0.0.1:7880',
    LIVEKIT_PUBLIC_URL: 'wss://synthetic.example.test',
    LIVEKIT_API_KEY: 'synthetic-key',
    LIVEKIT_API_SECRET: 'x'.repeat(40),
  });
  try {
    const verifier = new TokenVerifier('synthetic-key', 'x'.repeat(40));
    const results = await Promise.all(
      Array.from({ length: 300 }, async (_, i) => {
        const identity = randomUUID(),
          s = { ...session, id: randomUUID(), room_name: 'vn_' + randomUUID().replaceAll('-', '') },
          issued = await issueToken(s, identity, i % 2 ? 'CLIENT' : 'OBSERVER'),
          claims = await verifier.verify(issued.token);
        assert.equal(claims.sub, identity);
        assert.equal(claims.video?.room, s.room_name);
        assert.equal(claims.video?.roomJoin, true);
        assert.equal(claims.video?.canPublishData, false);
        assert.equal(claims.video?.roomAdmin, undefined);
        assert.equal(claims.video?.roomRecord, undefined);
        assert.equal(claims.video?.hidden, false);
        if (i % 2 === 0) assert.equal(claims.video?.canPublish, false);
        const raw = JSON.parse(Buffer.from(issued.token.split('.')[1]!, 'base64url').toString());
        assert.ok(raw.exp - raw.nbf <= 90);
        return claims.video!.room;
      }),
    );
    assert.equal(new Set(results).size, 300);
    const body = JSON.stringify({
      event: 'room_started',
      id: randomUUID(),
      createdAt: String(Math.floor(Date.now() / 1000)),
      room: { name: 'synthetic' },
    });
    const token = new AccessToken('synthetic-key', 'x'.repeat(40));
    const { createHash } = await import('node:crypto');
    token.sha256 = createHash('sha256').update(body).digest('base64');
    const signature = await token.toJwt();
    assert.equal((await receiver().receive(body, signature)).event, 'room_started');
    await assert.rejects(receiver().receive(body + ' ', signature));
    await assert.rejects(receiver().receive(body));
  } finally {
    names.forEach((n, i) => {
      if (old[i] === undefined) delete process.env[n];
      else process.env[n] = old[i];
    });
  }
});

import { summarizeMediaStats, type MediaStat } from '../packages/ui/src/session-stats.js';
test('media statistics deduplicate reports, use interval packet loss and prove relay from the selected candidate', () => {
  const previous = new Map<string, MediaStat>();
  const first: MediaStat[] = [
    {
      id: 'in',
      type: 'inbound-rtp',
      timestamp: 1000,
      bytesReceived: 1000,
      packetsLost: 10,
      packetsReceived: 90,
      jitter: 0.003,
    },
  ];
  assert.equal(summarizeMediaStats(first, previous).bitrate, 0);
  const next: MediaStat[] = [
    { ...first[0]!, timestamp: 2000, bytesReceived: 2000, packetsLost: 11, packetsReceived: 99 },
    {
      id: 'pair',
      type: 'candidate-pair',
      timestamp: 2000,
      state: 'succeeded',
      nominated: true,
      currentRoundTripTime: 0.025,
      localCandidateId: 'local',
    },
    { id: 'local', type: 'local-candidate', timestamp: 2000, candidateType: 'relay' },
  ];
  const summary = summarizeMediaStats([...next, ...next], previous);
  assert.equal(summary.bitrate, 8000);
  assert.equal(summary.loss, 10);
  assert.equal(summary.jitter, 3);
  assert.equal(summary.latency, 25);
  assert.equal(summary.route, 'relay');
  assert.equal(
    summarizeMediaStats(
      [{ id: 'unselected', type: 'local-candidate', timestamp: 3000, candidateType: 'relay' }],
      previous,
    ).route,
    'unknown',
  );
});
