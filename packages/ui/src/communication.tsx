'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { userApi, type AvatarValue } from './users-client';
import { UserAvatar } from './user-profile';
import { communicationCopy } from './communication-copy';
import { ChannelWorkspace, QuestionWorkspace, NotificationWorkspace } from './communication-panels';
type Conversation = { id: string; type: string; state: string; category: string; unread: number };
type Message = {
  id: string;
  sender_id: string;
  sequence: string;
  type: string;
  content: string;
  duration: number | null;
  reply_to: string | null;
  files: string[];
  created_at: string;
};
type Actor = { account_id: string; public_id: string; display_name: string; avatar: AvatarValue };
type History = {
  messages: Message[];
  actors: Actor[];
  members: { account_id: string; read_sequence: string; delivered_sequence: string }[];
  next: string;
};
export function Attachment({
  id,
  kind,
  t,
}: {
  id: string;
  kind: string;
  t: Record<string, string>;
}) {
  const [src, setSrc] = useState(''),
    [error, setError] = useState(''),
    [name, setName] = useState('');
  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src],
  );
  return (
    <div>
      {!src ? (
        <button
          onClick={() =>
            void (async () => {
              try {
                const link = await userApi<{ path: string }>(
                    'files/assets/' + id + '/link',
                    'POST',
                    {},
                  ),
                  f = await userApi<{ mime: string; base64: string; name: string }>(link.path);
                const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
                setSrc(URL.createObjectURL(new Blob([bytes], { type: f.mime })));
                setName(f.name);
              } catch {
                setError(t.error!);
              }
            })()
          }
        >
          {t.download}
        </button>
      ) : kind === 'VOICE' ? (
        <audio controls src={src} aria-label={t.attachment} />
      ) : kind === 'VIDEO' ? (
        <video controls src={src} aria-label={t.attachment} />
      ) : kind === 'IMAGE' ? (
        <img className="communication-image" src={src} alt={name || t.attachment} />
      ) : (
        <a href={src} download={name}>
          {name || t.download}
        </a>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export async function uploadCommunication(file: File, purpose = 'communication') {
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (buffer.length > 20 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
  let binary = '';
  for (let offset = 0; offset < buffer.length; offset += 32768)
    binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
  const uploaded = await userApi<{ id: string }>('files/assets', 'POST', {
    name: file.name,
    mime: file.type.split(';')[0],
    purpose,
    access: 'OWNER_ONLY',
    authorized_users: [],
    base64: btoa(binary),
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    const f = await userApi<{ state: string }>('files/assets/' + uploaded.id);
    if (f.state === 'READY') return uploaded.id;
    if (['REJECTED', 'INFECTED', 'DELETED'].includes(f.state)) throw Error('FILE_REJECTED');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error('SCAN_PENDING');
}
function Text({ value }: { value: string }) {
  return (
    <>
      {value.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
export function CommunicationWorkspace({
  locale,
  section = 'messages',
  admin = false,
  expert = false,
}: {
  locale: string;
  section?: string;
  admin?: boolean;
  expert?: boolean;
}) {
  const t = communicationCopy[locale]! as Record<string, string>,
    [rows, setRows] = useState<Conversation[]>([]),
    [selected, setSelected] = useState(''),
    [history, setHistory] = useState<History>({ messages: [], actors: [], members: [], next: '0' }),
    [body, setBody] = useState(''),
    [reply, setReply] = useState<Message | null>(null),
    [file, setFile] = useState<{ id: string; type: string; duration?: number } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [typing, setTyping] = useState(false),
    [presence, setPresence] = useState<{ account_id: string; state: string }[]>([]),
    [recording, setRecording] = useState(false);
  const active = useRef(''),
    request = useRef({ fingerprint: '', key: '' }),
    recorder = useRef<MediaRecorder | null>(null),
    media = useRef<MediaStream | null>(null),
    recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = async () =>
    setRows(
      await userApi<Conversation[]>(
        admin && section === 'inbox'
          ? 'communications/admin/inbox'
          : 'communications/conversations',
      ),
    );
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
  const fetchHistory = async (id: string, before?: string) => {
    const result = await userApi<History>(
      'communications/conversations/' + id + '/messages' + (before ? '?before=' + before : ''),
    );
    if (active.current !== id) return;
    setHistory((h) => ({
      ...result,
      messages: [
        ...new Map([...h.messages, ...result.messages].map((m) => [m.id, m])).values(),
      ].sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1)),
      next: before ? h.next : result.next,
    }));
    const latest = result.messages.at(-1);
    if (latest && !before) {
      await userApi('communications/conversations/' + id + '/receipt', 'POST', {
        sequence: latest.sequence,
        state: document.hidden ? 'DELIVERED' : 'READ',
      });
      void load();
    }
    const p = await userApi<typeof presence>('presence/' + id);
    if (active.current === id) setPresence(p);
  };
  useEffect(() => {
    void load().catch(() => setError(t.error!));
    const q = new URLSearchParams(location.search);
    if (q.get('conversation')) setSelected(q.get('conversation')!);
    if (q.get('booking'))
      void act(async () => {
        const c = await userApi<Conversation>('communications/conversations', 'POST', {
          type: 'BOOKING',
          context_id: q.get('booking'),
          request_key: crypto.randomUUID(),
        });
        setSelected(c.id);
        await load();
      });
    return () => {
      if (recordTimer.current) clearTimeout(recordTimer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== 'inactive') recorder.current.stop();
      }
      media.current?.getTracks().forEach((x) => x.stop());
    };
  }, [section]);
  useEffect(() => {
    active.current = selected;
    setHistory({ messages: [], actors: [], members: [], next: '0' });
    setReply(null);
    setFile(null);
    if (!selected) return;
    void fetchHistory(selected).catch(() => setError(t.error!));
    const listener = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.conversation_id !== selected) return;
      if (d.type === 'typing') {
        setTyping(!!d.active);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), 5000);
      } else if (['message', 'receipt'].includes(d.type))
        void fetchHistory(selected).catch(() => {});
    };
    window.addEventListener('vianoor:communication', listener);
    const timer = setInterval(() => void fetchHistory(selected).catch(() => {}), 15000);
    return () => {
      clearInterval(timer);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      window.removeEventListener('vianoor:communication', listener);
    };
  }, [selected]);
  async function startRecording() {
    try {
      media.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((x) =>
        MediaRecorder.isTypeSupported(x),
      );
      if (!mime) throw Error('RECORDING_UNSUPPORTED');
      const chunks: BlobPart[] = [],
        started = Date.now(),
        rec = new MediaRecorder(media.current, { mimeType: mime });
      recorder.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        if (recordTimer.current) clearTimeout(recordTimer.current);
        media.current?.getTracks().forEach((x) => x.stop());
        setRecording(false);
        const duration = Math.min(600, Math.max(1, Math.round((Date.now() - started) / 1000))),
          ext = mime === 'audio/mp4' ? 'm4a' : mime.split('/')[1];
        void act(async () => {
          const id = await uploadCommunication(new File(chunks, 'voice.' + ext, { type: mime }));
          setFile({ id, type: 'VOICE', duration });
        });
      };
      rec.start();
      setRecording(true);
      recordTimer.current = setTimeout(() => rec.stop(), 600000);
    } catch {
      media.current?.getTracks().forEach((x) => x.stop());
      setError(t.error!);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const data = {
          type: file?.type ?? 'TEXT',
          content: body,
          reply_to: reply?.id ?? null,
          files: file ? [file.id] : [],
          ...(file?.duration ? { duration: file.duration } : {}),
        },
        fingerprint = selected + JSON.stringify(data);
      if (request.current.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() };
      await userApi('communications/conversations/' + selected + '/messages', 'POST', {
        ...data,
        request_key: request.current.key,
      });
      setBody('');
      setReply(null);
      setFile(null);
      await fetchHistory(selected);
    });
  }
  if (section === 'channels')
    return <ChannelWorkspace locale={locale} expert={expert} admin={admin} />;
  if (section === 'questions') return <QuestionWorkspace locale={locale} admin={admin} />;
  if (section === 'notifications') return <NotificationWorkspace locale={locale} admin={admin} />;
  return (
    <section className="user-card communication-workspace">
      <h2>{admin && section === 'inbox' ? t.inbox : t.messages}</h2>
      <p>{t.contextHint}</p>
      {error && <p role="alert">{error}</p>}
      <div className="user-actions">
        <button disabled={busy} onClick={() => void act(load)}>
          {t.refresh}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const c = await userApi<Conversation>('communications/conversations', 'POST', {
                type: 'SUPPORT',
                request_key: crypto.randomUUID(),
              });
              setSelected(c.id);
              await load();
            })
          }
        >
          {t.support}
        </button>
      </div>
      <div className="communication-layout">
        <nav aria-label={t.messages}>
          {rows.map((c) => (
            <article key={c.id}>
              <button
                aria-current={selected === c.id ? 'true' : undefined}
                onClick={() =>
                  void act(async () => {
                    if (admin && section === 'inbox')
                      await userApi('communications/admin/' + c.id + '/review', 'POST', {
                        action: 'CLAIM',
                      });
                    setSelected(c.id);
                  })
                }
              >
                {t[c.type] ?? c.type} {c.unread ? `(${c.unread})` : ''}
                <small>
                  {t[c.state] ?? c.state} {c.category}
                </small>
              </button>
              {admin && section === 'inbox' && (
                <div className="user-actions">
                  {(c.type === 'CHANNEL_INBOX'
                    ? ['FORWARD', 'ARCHIVE', 'REOPEN']
                    : ['ARCHIVE', 'REOPEN']
                  ).map((action) => (
                    <button
                      key={action}
                      onClick={() =>
                        void act(async () => {
                          await userApi('communications/admin/' + c.id + '/review', 'POST', {
                            action,
                          });
                          await load();
                        })
                      }
                    >
                      {
                        t[
                          action === 'FORWARD'
                            ? 'forward'
                            : action === 'ARCHIVE'
                              ? 'archive'
                              : 'reopen'
                        ]
                      }
                    </button>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const category = String(new FormData(e.currentTarget).get('category'));
                      void act(async () => {
                        await userApi('communications/admin/' + c.id + '/review', 'POST', {
                          action: 'CATEGORIZE',
                          category,
                        });
                        await load();
                      });
                    }}
                  >
                    <label>
                      {t.category}
                      <input name="category" maxLength={80} />
                    </label>
                    <button>{t.save}</button>
                  </form>
                </div>
              )}
            </article>
          ))}
        </nav>
        <div>
          {!selected ? (
            <p>{t.choose}</p>
          ) : (
            <>
              <div className="user-actions">
                {history.actors.map((a) => (
                  <span key={a.account_id}>
                    <UserAvatar avatar={a.avatar} name={a.display_name} size={32} />
                    {a.display_name || a.public_id} ·{' '}
                    {t[presence.find((p) => p.account_id === a.account_id)?.state ?? 'OFFLINE']}
                  </span>
                ))}
              </div>
              {history.messages[0] && BigInt(history.messages[0].sequence) > 1n && (
                <button
                  onClick={() =>
                    void act(() => fetchHistory(selected, history.messages[0]!.sequence))
                  }
                >
                  {t.loadMore}
                </button>
              )}
              <ol className="communication-history" aria-label={t.messages}>
                {history.messages.map((m) => {
                  const a = history.actors.find((a) => a.account_id === m.sender_id),
                    others = history.members.filter((x) => x.account_id !== m.sender_id),
                    state =
                      others.length &&
                      others.every((x) => BigInt(x.read_sequence) >= BigInt(m.sequence))
                        ? 'READ'
                        : others.length &&
                            others.every((x) => BigInt(x.delivered_sequence) >= BigInt(m.sequence))
                          ? 'DELIVERED'
                          : 'SENT';
                  return (
                    <li key={m.id} id={'message-' + m.id}>
                      <header>
                        {a && <UserAvatar avatar={a.avatar} name={a.display_name} size={28} />}
                        <strong>{a?.display_name || a?.public_id || t.messages}</strong>
                        <time dateTime={m.created_at}>
                          {new Date(m.created_at).toLocaleString(locale)}
                        </time>
                      </header>
                      {m.reply_to && (
                        <small>
                          {t.reply}:{' '}
                          {history.messages
                            .find((x) => x.id === m.reply_to)
                            ?.content.slice(0, 100) || '…'}
                        </small>
                      )}
                      <p className="communication-text">
                        <Text value={m.content} />
                      </p>
                      {m.files.map((id) => (
                        <Attachment key={id} id={id} kind={m.type} t={t} />
                      ))}
                      <footer>
                        <small>{t[state]}</small>
                        <button onClick={() => setReply(m)}>{t.reply}</button>
                      </footer>
                    </li>
                  );
                })}
              </ol>
              {typing && <p role="status">{t.typing}</p>}
              <form className="communication-compose" onSubmit={(e) => void submit(e)}>
                {reply && (
                  <p>
                    {t.reply}: {reply.content.slice(0, 80)}{' '}
                    <button type="button" onClick={() => setReply(null)}>
                      {t.cancel}
                    </button>
                  </p>
                )}
                <label>
                  {t.body}
                  <textarea
                    value={body}
                    maxLength={12000}
                    onChange={(e) => {
                      setBody(e.target.value);
                      window.dispatchEvent(
                        new CustomEvent('vianoor:typing', {
                          detail: { conversation_id: selected, active: !!e.target.value },
                        }),
                      );
                    }}
                  />
                </label>
                <label>
                  {t.attachment}
                  <input
                    type="file"
                    disabled={busy || recording}
                    accept="image/jpeg,image/png,image/webp,application/pdf,audio/webm,audio/ogg,audio/mp4,audio/mpeg,video/webm,video/mp4"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void act(async () => {
                          const id = await uploadCommunication(f);
                          setFile({
                            id,
                            type: f.type.startsWith('image/')
                              ? 'IMAGE'
                              : f.type.startsWith('video/')
                                ? 'VIDEO'
                                : 'FILE',
                          });
                        });
                    }}
                  />
                </label>
                {busy && <p role="status">{t.filePending}</p>}
                {file && (
                  <p>
                    {t.fileReady}{' '}
                    <button type="button" onClick={() => setFile(null)}>
                      {t.clearFile}
                    </button>
                  </p>
                )}
                <p>{t.recordHint}</p>
                <div className="user-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (recording ? recorder.current?.stop() : void startRecording())}
                  >
                    {recording ? t.stop : t.record}
                  </button>
                  <button disabled={busy || recording || (!body.trim() && !file)}>{t.send}</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
