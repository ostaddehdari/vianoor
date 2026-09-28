'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Room, Track } from 'livekit-client';
import { userApi, usersBase } from './users-client';
import { CommunicationWorkspace } from './communication';
import { summarizeMediaStats, type MediaStat } from './session-stats';
import { sessionsCopy } from './sessions-copy';
type Row = {
  id: string;
  booking_id: string;
  state: string;
  kind: string;
  title: string;
  expert_name: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  role: string;
  ready: boolean;
  server_now: string;
  policy: { recording: string; client_screen_share: boolean; observer: string };
  members: { identity: string; role: string; connected: boolean }[];
  observers: { id: string; reason: string; emergency: boolean }[];
  notes: { visibility: string; body: string }[];
};
type Recordings = {
  enabled: boolean;
  consented: boolean;
  download: boolean;
  items: { id: string; state: string; file_id: string | null; expires_at: string }[];
};
export function SessionWorkspace({ locale, admin = false }: { locale: string; admin?: boolean }) {
  const t = sessionsCopy[locale]! as Record<string, string>,
    [list, setList] = useState<Row[]>([]),
    [s, setSession] = useState<Row | null>(null),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [mic, setMic] = useState(''),
    [camera, setCamera] = useState(''),
    [speaker, setSpeaker] = useState(''),
    [previewReady, setPreviewReady] = useState(false),
    [level, setLevel] = useState(0),
    [connection, setConnection] = useState('disconnected'),
    [quality, setQuality] = useState('unknown'),
    [route, setRoute] = useState('unknown'),
    [now, setNow] = useState(Date.now()),
    [chat, setChat] = useState(false),
    [textJoined, setTextJoined] = useState(false),
    [chatId, setChatId] = useState(''),
    [layout, setLayout] = useState(false),
    [report, setReport] = useState(''),
    [monitorId, setMonitorId] = useState(''),
    [observerRequest, setObserverRequest] = useState(''),
    [recordings, setRecordings] = useState<Recordings | null>(null);
  const room = useRef<Room | null>(null),
    stream = useRef<MediaStream | null>(null),
    video = useRef<HTMLVideoElement | null>(null),
    tiles = useRef<HTMLDivElement | null>(null),
    audio = useRef<AudioContext | null>(null),
    meter = useRef<ReturnType<typeof setInterval> | null>(null),
    offset = useRef(0),
    previousStats = useRef(new Map<string, MediaStat>());
  const stopPreview = () => {
    stream.current?.getTracks().forEach((x) => x.stop());
    stream.current = null;
    if (meter.current) clearInterval(meter.current);
    void audio.current?.close();
    audio.current = null;
    setPreviewReady(false);
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(t.error!);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (id = selected) => {
    if (id) {
      const v = await userApi<Row>('sessions/' + id);
      offset.current = Date.parse(v.server_now) - Date.now();
      setSession(v);
      if (['CLIENT', 'EXPERT'].includes(v.role) && v.policy.recording !== 'OFF')
        setRecordings(await userApi<Recordings>('sessions/' + id + '/recordings'));
      else setRecordings(null);
      if (
        [
          'COMPLETED',
          'CANCELLED',
          'NO_SHOW_USER',
          'NO_SHOW_EXPERT',
          'TECHNICAL_FAILURE',
          'INTERRUPTED',
          'TERMINATED_BY_ADMIN',
        ].includes(v.state)
      )
        void room.current?.disconnect();
    } else setList(await userApi<Row[]>(admin ? 'sessions/admin' : 'sessions'));
  };
  useEffect(() => {
    const q = new URLSearchParams(location.search),
      id = q.get('session');
    void act(async () => {
      if (id) setSelected(id);
      else if (q.get('booking')) {
        const r = await userApi<{ id: string }>('sessions', 'POST', {
          booking_id: q.get('booking'),
        });
        setSelected(r.id);
      } else await refresh('');
    });
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => {
      clearInterval(timer);
      stream.current?.getTracks().forEach((x) => x.stop());
      if (meter.current) clearInterval(meter.current);
      void audio.current?.close();
      void room.current?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    setSession(null);
    setRecordings(null);
    setChat(false);
    setTextJoined(false);
    setChatId('');
    void act(() => refresh(selected));
    const timer = setInterval(() => void refresh(selected).catch(() => {}), 5000);
    return () => {
      clearInterval(timer);
      void room.current?.disconnect();
    };
  }, [selected]);
  const post = async (action: string, data: unknown = {}) => {
    await userApi('sessions/' + selected + '/' + action, 'POST', data);
    await refresh();
  };
  const telemetry = async (event: string) => {
    if (!selected) return;
    let metrics = { latency: 0, jitter: 0, loss: 0, bitrate: 0 };
    if (event === 'HEARTBEAT' && room.current?.state === 'connected') {
      const participants = [
          room.current.localParticipant,
          ...room.current.remoteParticipants.values(),
        ],
        rows: MediaStat[] = [];
      for (const participant of participants)
        for (const publication of participant.trackPublications.values()) {
          const report = await publication.track?.getRTCStatsReport();
          report?.forEach((value) => rows.push(value as MediaStat));
        }
      const summary = summarizeMediaStats(rows, previousStats.current);
      setRoute(summary.route);
      metrics = {
        latency: summary.latency,
        jitter: summary.jitter,
        loss: summary.loss,
        bitrate: summary.bitrate,
      };
    }
    await userApi('sessions/' + selected + '/telemetry', 'POST', { event, ...metrics });
  };
  useEffect(() => {
    if (!s || !['JOINABLE', 'IN_SESSION'].includes(s.state)) return;
    const timer = setInterval(() => {
      if (room.current?.state === 'connected' || (s.kind === 'TEXT' && textJoined))
        void telemetry('HEARTBEAT').catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [s?.state, selected, textJoined]);
  async function preview() {
    stopPreview();
    if (s?.kind === 'TEXT') {
      setPreviewReady(true);
      return;
    }
    stream.current = await navigator.mediaDevices.getUserMedia({
      audio: mic ? { deviceId: { exact: mic } } : true,
      video: s?.kind === 'VIDEO' ? (camera ? { deviceId: { exact: camera } } : true) : false,
    });
    if (video.current) {
      video.current.srcObject = stream.current;
      await video.current.play();
    }
    setDevices(await navigator.mediaDevices.enumerateDevices());
    audio.current = new AudioContext();
    const analyser = audio.current.createAnalyser();
    audio.current.createMediaStreamSource(stream.current).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    meter.current = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      setLevel(Math.min(100, Math.max(...samples.map((x) => Math.abs(x - 128))) * 3));
    }, 150);
    setPreviewReady(true);
  }
  async function join() {
    if (!s) return;
    const sdk = await import('livekit-client'),
      result = await userApi<{
        token: string;
        url: string;
        capabilities: { microphone: boolean; camera: boolean };
      }>('sessions/' + selected + '/token', 'POST', {});
    stopPreview();
    await room.current?.disconnect();
    const r = new sdk.Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: mic ? { deviceId: mic } : {},
      videoCaptureDefaults: camera ? { deviceId: camera } : {},
    });
    room.current = r;
    previousStats.current.clear();
    tiles.current?.replaceChildren();
    const attach = (track: Track, identity: string) => {
      if (!tiles.current) return;
      const el = track.attach();
      el.dataset.participant = identity;
      el.setAttribute(
        'aria-label',
        t[s.members.find((m) => m.identity === identity)?.role ?? 'CLIENT']!,
      );
      tiles.current.appendChild(el);
    };
    r.on(sdk.RoomEvent.TrackSubscribed, (track, _publication, participant) =>
      attach(track, participant.identity),
    );
    r.on(sdk.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
    r.on(sdk.RoomEvent.LocalTrackPublished, (p) => {
      if (p.track && p.track.kind === 'video') {
        const el = p.track.attach();
        el.muted = true;
        tiles.current?.appendChild(el);
      }
    });
    r.on(sdk.RoomEvent.LocalTrackUnpublished, (p) =>
      p.track?.detach().forEach((el) => el.remove()),
    );
    r.on(sdk.RoomEvent.ConnectionStateChanged, (state) => setConnection(state));
    r.on(sdk.RoomEvent.Reconnecting, () => void telemetry('CONNECTION_LOST').catch(() => {}));
    r.on(sdk.RoomEvent.Reconnected, () => void telemetry('RECONNECTED').catch(() => {}));
    r.on(sdk.RoomEvent.ConnectionQualityChanged, (q, p) => {
      if (p.identity === r.localParticipant.identity) setQuality(q);
    });
    await r.connect(result.url, result.token, {
      rtcConfig: {
        iceTransportPolicy:
          new URLSearchParams(location.search).get('relay') === '1' ? 'relay' : 'all',
      },
    });
    await r.startAudio();
    if (result.capabilities.microphone) await r.localParticipant.setMicrophoneEnabled(true);
    if (result.capabilities.camera) await r.localParticipant.setCameraEnabled(true);
    if (speaker) await r.switchActiveDevice('audiooutput', speaker);
  }
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  };
  return (
    <section className="user-card session-workspace">
      <h2>{t.sessions}</h2>
      {error && <p role="alert">{error}</p>}
      {!selected && (
        <nav>
          {list.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                if (admin) {
                  setMonitorId(x.id);
                  setObserverRequest('');
                  void act(async () =>
                    setReport(
                      JSON.stringify(
                        await userApi('sessions/' + x.id + '/technical-report'),
                        null,
                        2,
                      ),
                    ),
                  );
                } else setSelected(x.id);
              }}
            >
              {x.title || x.id} · {t[x.state] ?? x.state} ·{' '}
              {new Date(x.scheduled_start).toLocaleString(locale)}
            </button>
          ))}
        </nav>
      )}
      {report && <pre>{report}</pre>}
      {admin && monitorId && !selected && (
        <form
          onSubmit={(e) => {
            const d = form(e);
            void act(async () => {
              const result = await userApi<{ id: string }>(
                'sessions/' + monitorId + '/observers',
                'POST',
                { reason: d.reason, emergency: d.emergency === 'on' },
              );
              setObserverRequest(result.id);
            });
          }}
        >
          <h3>{t.observerRequest}</h3>
          <label>
            {t.reason}
            <textarea name="reason" required minLength={5} maxLength={300} />
          </label>
          <label>
            <input type="checkbox" name="emergency" />
            {t.emergency}
          </label>
          <button disabled={busy}>{t.observerRequest}</button>
          {observerRequest && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await userApi('sessions/' + monitorId + '/observer-admit', 'POST', {
                    request_id: observerRequest,
                  });
                  setSelected(monitorId);
                })
              }
            >
              {t.admit}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await userApi('sessions/' + monitorId + '/terminate', 'POST', {});
                await refresh('');
              })
            }
          >
            {t.terminate}
          </button>
        </form>
      )}
      {!s && <p>{t.choose}</p>}
      {s && (
        <>
          <header>
            <h3>
              {s.title} · {s.expert_name}
            </h3>
            <p>
              {t[s.state] ?? s.state} · {t.role}: {t[s.role]}
            </p>
            <p>
              {t.countdown}:{' '}
              {Math.max(0, Math.ceil((Date.parse(s.scheduled_start) - now) / 1000)).toLocaleString(
                locale,
              )}
            </p>
            {s.actual_started_at && (
              <p>
                {Math.max(
                  0,
                  Math.floor(
                    ((s.actual_ended_at ? Date.parse(s.actual_ended_at) : now) -
                      Date.parse(s.actual_started_at)) /
                      1000,
                  ),
                ).toLocaleString(locale)}{' '}
                {t.seconds}
              </p>
            )}
          </header>
          {s.policy.recording === 'OFF' ? (
            <p>{t.recordingOff}</p>
          ) : (
            recordings && (
              <section aria-label={t.recording}>
                <h3>{t.recording}</h3>
                {!recordings.enabled ? (
                  <p>{t.recordingUnavailable}</p>
                ) : (
                  <>
                    {!recordings.consented && <p>{t.recordingWaiting}</p>}
                    <div className="user-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() => post('recording/consent', { accepted: true }))
                        }
                      >
                        {t.recordingConsent}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() => post('recording/consent', { accepted: false }))
                        }
                      >
                        {t.recordingWithdraw}
                      </button>
                      {s.role === 'EXPERT' && s.state === 'IN_SESSION' && (
                        <button
                          disabled={
                            busy ||
                            !recordings.consented ||
                            recordings.items.some((x) =>
                              ['STARTING', 'ACTIVE', 'STOP_REQUESTED', 'UNKNOWN'].includes(x.state),
                            )
                          }
                          onClick={() => void act(() => post('recording/start'))}
                        >
                          {t.recordingStart}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {recordings.items.map((item) => (
                  <div key={item.id}>
                    {['STARTING', 'ACTIVE', 'STOP_REQUESTED', 'UNKNOWN'].includes(item.state) && (
                      <div role="status" className="recording-indicator">
                        <strong>
                          {item.state === 'ACTIVE'
                            ? t.recordingActive
                            : item.state === 'STOP_REQUESTED'
                              ? t.recordingStopping
                              : t.recordingProcessing}
                        </strong>
                        <button
                          disabled={busy}
                          onClick={() => void act(() => post('recording/stop'))}
                        >
                          {t.recordingStop}
                        </button>
                      </div>
                    )}
                    {item.state === 'FINALIZING' && <p role="status">{t.recordingProcessing}</p>}
                    {item.state === 'FAILED' && <p>{t.recordingFailed}</p>}
                    {item.state === 'READY' &&
                      Date.parse(item.expires_at) > now &&
                      item.file_id && (
                        <>
                          <video
                            controls
                            preload="none"
                            aria-label={t.recording}
                            style={{ maxWidth: '100%' }}
                            src={
                              usersBase + '/api/users/files/recordings/' + item.file_id + '/stream'
                            }
                          />
                          {recordings.download && (
                            <a
                              href={
                                usersBase +
                                '/api/users/files/recordings/' +
                                item.file_id +
                                '/stream?download=1'
                              }
                            >
                              {t.recordingDownload}
                            </a>
                          )}
                        </>
                      )}
                    {Date.parse(item.expires_at) <= now && <p>{t.recordingExpired}</p>}
                  </div>
                ))}
              </section>
            )
          )}
          <div className="user-actions">
            {s.members.map((m) => (
              <span key={m.identity}>
                {t[m.role]} · {m.connected ? t.connected : t.disconnected}
              </span>
            ))}
          </div>
          {s.observers.map((o) => (
            <div key={o.id} role="status">
              <p>
                {t.observerWarning} {o.reason}
              </p>
              {['CLIENT', 'EXPERT'].includes(s.role) && (
                <>
                  <button
                    onClick={() =>
                      void act(() => post('observer-consent', { request_id: o.id, accepted: true }))
                    }
                  >
                    {t.allow}
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        post('observer-consent', { request_id: o.id, accepted: false }),
                      )
                    }
                  >
                    {t.deny}
                  </button>
                </>
              )}
            </div>
          ))}
          <details open={connection === 'disconnected'}>
            <summary>{t.devices}</summary>
            <p>{t.permission}</p>
            <video
              ref={video}
              autoPlay
              muted
              playsInline
              className="session-preview"
              aria-label={t.camera}
            />
            <meter min={0} max={100} value={level} aria-label={t.microphone} />
            {(['audioinput', 'videoinput', 'audiooutput'] as const).map((kind, i) => (
              <label key={kind}>
                {[t.microphone, t.camera, t.speaker][i]}
                <select
                  value={[mic, camera, speaker][i]}
                  onChange={(e) => {
                    [setMic, setCamera, setSpeaker][i]!(e.target.value);
                    setPreviewReady(false);
                    if (room.current)
                      void room.current
                        .switchActiveDevice(kind, e.target.value)
                        .catch(() => setError(t.error!));
                  }}
                >
                  <option value="">—</option>
                  {devices
                    .filter((d) => d.kind === kind)
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || kind}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <p>{t.testPending}</p>
            <div className="user-actions">
              <button disabled={busy} onClick={() => void act(preview)}>
                {t.preview}
              </button>
              <button
                onClick={() =>
                  void act(async () => {
                    const a = new AudioContext(),
                      o = a.createOscillator(),
                      gain = a.createGain();
                    if (speaker) {
                      const output = a as AudioContext & {
                        setSinkId?: (id: string) => Promise<void>;
                      };
                      if (!output.setSinkId) {
                        await a.close();
                        throw Error('OUTPUT_SELECTION_UNSUPPORTED');
                      }
                      await output.setSinkId(speaker);
                    }
                    gain.gain.value = 0.05;
                    o.connect(gain);
                    gain.connect(a.destination);
                    o.start();
                    o.stop(a.currentTime + 0.5);
                    o.onended = () => void a.close();
                  })
                }
              >
                {t.testSound}
              </button>
              <button
                disabled={busy || !previewReady}
                onClick={() =>
                  void act(async () => {
                    const begin = performance.now();
                    await userApi('sessions/' + selected);
                    await post('device-check', {
                      microphone: s.kind === 'TEXT' || !!stream.current?.getAudioTracks().length,
                      camera: !!stream.current?.getVideoTracks().length,
                      webrtc: typeof RTCPeerConnection !== 'undefined',
                      latency_ms: Math.min(60000, performance.now() - begin),
                      error: 'NONE',
                    });
                  })
                }
              >
                {t.ready}
              </button>
            </div>
          </details>
          <div className="user-actions">
            <button disabled={busy} onClick={() => void act(() => post('waiting-room'))}>
              {t.waiting}
            </button>
            {s.role === 'EXPERT' && (
              <button disabled={busy || !s.ready} onClick={() => void act(() => post('start'))}>
                {t.start}
              </button>
            )}
            {s.kind === 'TEXT' && (
              <button
                disabled={busy || !s.ready || !['JOINABLE', 'IN_SESSION'].includes(s.state)}
                onClick={() =>
                  void act(async () => {
                    await telemetry('HEARTBEAT');
                    setTextJoined(true);
                    setConnection('connected');
                  })
                }
              >
                {t.join}
              </button>
            )}
            {s.kind !== 'TEXT' && (
              <button
                disabled={
                  busy ||
                  (!s.ready && ['CLIENT', 'EXPERT'].includes(s.role)) ||
                  !['JOINABLE', 'IN_SESSION'].includes(s.state)
                }
                onClick={() => void act(join)}
              >
                {t.join}
              </button>
            )}
            <button
              onClick={() =>
                void act(async () => {
                  const c = await userApi<{ id: string }>('communications/conversations', 'POST', {
                    type: 'BOOKING',
                    context_id: s.booking_id,
                    request_key: crypto.randomUUID(),
                  });
                  setChatId(c.id);
                  setChat((v) => !v);
                })
              }
            >
              {t.chat}
            </button>
            <button onClick={() => void act(() => telemetry('HELP_REQUESTED'))}>{t.help}</button>
          </div>
          <div className={'session-media ' + (layout ? 'session-media-focus' : '')} ref={tiles} />
          <p role="status">
            {t[connection] ?? connection} · {t.quality}:{' '}
            {quality === 'poor' ? t.poorQuality : (t[quality] ?? quality)} · {t['route_' + route]}
          </p>
          {quality === 'poor' && <p>{t.poor}</p>}
          <div className="user-actions">
            {connection === 'connected' && (
              <>
                <button
                  onClick={() =>
                    void act(async () => {
                      const p = room.current!.localParticipant;
                      await p.setMicrophoneEnabled(!p.isMicrophoneEnabled);
                      await telemetry('MIC_MUTED');
                    })
                  }
                >
                  {t.mute}
                </button>
                {s.kind === 'VIDEO' && (
                  <>
                    <button
                      onClick={() =>
                        void act(async () => {
                          const p = room.current!.localParticipant;
                          await p.setCameraEnabled(!p.isCameraEnabled);
                          await telemetry('CAMERA_DISABLED');
                        })
                      }
                    >
                      {t.video}
                    </button>
                    {(s.role === 'EXPERT' || s.policy.client_screen_share) && (
                      <button
                        onClick={() =>
                          void act(async () => {
                            const p = room.current!.localParticipant,
                              next = !p.isScreenShareEnabled;
                            await p.setScreenShareEnabled(next);
                            await telemetry(next ? 'SCREEN_SHARE_STARTED' : 'SCREEN_SHARE_STOPPED');
                          })
                        }
                      >
                        {t.share}
                      </button>
                    )}
                  </>
                )}
                <button onClick={() => setLayout((x) => !x)}>{t.layout}</button>
                <button
                  onClick={() =>
                    void tiles.current?.requestFullscreen().catch(() => setError(t.error!))
                  }
                >
                  {t.fullscreen}
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      await room.current?.disconnect();
                      await post('leave');
                      stopPreview();
                      setTextJoined(false);
                      setConnection('disconnected');
                    })
                  }
                >
                  {t.leave}
                </button>
              </>
            )}
          </div>
          {chat && chatId && <CommunicationWorkspace locale={locale} conversationId={chatId} />}{' '}
          {s.role === 'EXPERT' && (
            <>
              <form
                onSubmit={(e) => {
                  const d = form(e);
                  void act(() => post('end', { outcome: d.outcome }));
                }}
              >
                <label>
                  {t.outcome}
                  <select name="outcome">
                    <option value="COMPLETED">{t.COMPLETED}</option>
                    <option value="FOLLOW_UP_REQUIRED">{t.followUp}</option>
                    <option value="TECHNICAL_FAILURE">{t.TECHNICAL_FAILURE}</option>
                    <option value="INTERRUPTED">{t.INTERRUPTED}</option>
                  </select>
                </label>
                <button disabled={busy}>{t.end}</button>
              </form>
              <form
                onSubmit={(e) => {
                  const d = form(e);
                  void act(() => post('notes', d));
                }}
              >
                <label>
                  {t.note}
                  <textarea name="body" maxLength={20000} />
                </label>
                <select name="visibility" aria-label={t.note}>
                  <option value="PRIVATE_EXPERT_NOTE">{t.privateNote}</option>
                  <option value="SHARED_SESSION_NOTE">{t.sharedNote}</option>
                </select>
                <button>{t.save}</button>
              </form>
            </>
          )}
          {s.notes.map((n, i) => (
            <article key={i}>
              <h4>{n.visibility === 'PRIVATE_EXPERT_NOTE' ? t.privateNote : t.sharedNote}</h4>
              <p>{n.body}</p>
            </article>
          ))}
          {s.role === 'CLIENT' && s.state === 'COMPLETED' && (
            <form
              onSubmit={(e) => {
                const d = form(e);
                void act(async () => {
                  await userApi('ratings', 'POST', {
                    session_id: s.id,
                    overall: Number(d.overall),
                    punctuality: Number(d.punctuality),
                    communication: Number(d.communication),
                    technical: Number(d.technical),
                    technical_issues: [
                      'AUDIO',
                      'VIDEO',
                      'DISCONNECT',
                      'JOIN',
                      'SCREEN_SHARE',
                    ].filter((k) => d['issue_' + k] === 'on'),
                    review: d.review,
                  });
                });
              }}
            >
              <h3>{t.feedback}</h3>
              {['overall', 'punctuality', 'communication', 'technical'].map((k) => (
                <label key={k}>
                  {t[k]}
                  <input type="number" name={k} min={1} max={5} required defaultValue={5} />
                </label>
              ))}
              {['AUDIO', 'VIDEO', 'DISCONNECT', 'JOIN', 'SCREEN_SHARE'].map((k) => (
                <label key={k}>
                  <input type="checkbox" name={'issue_' + k} />
                  {t['issue_' + k]}
                </label>
              ))}
              <label>
                {t.review}
                <textarea name="review" maxLength={3000} />
              </label>
              <button>{t.submit}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
