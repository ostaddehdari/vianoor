'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { userApi, usersBase } from './users-client';
import { communicationCopy } from './communication-copy';
import { Attachment, uploadCommunication } from './communication';
type Row = Record<string, unknown>;
const value = (r: Row, key: string) => String(r[key] ?? '');
const fields = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
};
function useActions(locale: string) {
  const t = communicationCopy[locale]! as Record<string, string>,
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
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
  return { t, error, busy, act };
}
export function ChannelWorkspace({
  locale,
  expert = false,
  admin = false,
}: {
  locale: string;
  expert?: boolean;
  admin?: boolean;
}) {
  const { t, error, busy, act } = useActions(locale),
    [rows, setRows] = useState<Row[]>([]),
    [channel, setChannel] = useState<Row | null>(null),
    [comments, setComments] = useState<Record<string, Row[]>>({}),
    [attachments, setAttachments] = useState<string[]>([]);
  const load = async () => setRows(await userApi<Row[]>('channels')),
    select = async (id: string) => setChannel(await userApi<Row>('channels/' + id));
  useEffect(() => {
    void act(async () => {
      await load();
      const id = new URLSearchParams(location.search).get('channel');
      if (id) await select(id);
    });
  }, []);
  return (
    <section className="user-card communication-workspace">
      <h2>{t.channels}</h2>
      <p>{t.channelHint}</p>
      {error && <p role="alert">{error}</p>}
      {expert && (
        <details>
          <summary>{t.createChannel}</summary>
          <form
            className="scholar-form"
            onSubmit={(e) => {
              const d = fields(e);
              void act(async () => {
                const c = await userApi<Row>('channels', 'POST', {
                  title: d.title,
                  description: d.description,
                  comments_enabled: d.comments === 'on',
                });
                await load();
                await select(value(c, 'id'));
              });
            }}
          >
            <label>
              {t.channelTitle}
              <input name="title" required minLength={2} maxLength={120} />
            </label>
            <label>
              {t.description}
              <textarea name="description" maxLength={2000} />
            </label>
            <label>
              <input name="comments" type="checkbox" defaultChecked />
              {t.commentsEnabled}
            </label>
            <button disabled={busy}>{t.save}</button>
          </form>
        </details>
      )}
      <nav className="user-actions">
        {rows.map((r) => (
          <button key={value(r, 'id')} onClick={() => void act(() => select(value(r, 'id')))}>
            {value(r, 'title')}
          </button>
        ))}
      </nav>
      {channel && (
        <>
          <h3>{value(channel, 'title')}</h3>
          <p>{value(channel, 'description')}</p>
          <div className="user-actions">
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await userApi('channels/' + channel.id + '/follow', 'POST', {
                    follow: !channel.following,
                  });
                  await select(value(channel, 'id'));
                })
              }
            >
              {channel.following ? t.unfollow : t.follow}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const c = await userApi<Row>('communications/conversations', 'POST', {
                    type: 'CHANNEL_INBOX',
                    context_id: channel.id,
                    request_key: crypto.randomUUID(),
                  });
                  location.assign(`${usersBase}/${locale}/account/messages?conversation=${c.id}`);
                })
              }
            >
              {t.sendToChannel}
            </button>
          </div>
          {!!channel.owner && (
            <form
              className="scholar-form"
              onSubmit={(e) => {
                const d = fields(e);
                void act(async () => {
                  await userApi('channels/' + channel.id + '/posts', 'POST', {
                    request_key: crypto.randomUUID(),
                    body: d.body,
                    files: attachments,
                  });
                  setAttachments([]);
                  await select(value(channel, 'id'));
                });
              }}
            >
              <label>
                {t.body}
                <textarea name="body" maxLength={12000} />
              </label>
              <label>
                {t.attachment}
                <input
                  type="file"
                  disabled={busy}
                  accept="image/*,application/pdf,audio/webm,audio/ogg,audio/mp4,audio/mpeg,video/webm,video/mp4"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void act(async () =>
                        setAttachments([await uploadCommunication(file, 'channel')]),
                      );
                  }}
                />
              </label>
              {attachments.length > 0 && <p>{t.fileReady}</p>}
              <button disabled={busy}>{t.post}</button>
            </form>
          )}
          {((channel.posts ?? []) as Row[]).map((p) => (
            <article className="communication-post" key={value(p, 'id')}>
              <p className="communication-text">{value(p, 'body')}</p>
              <time>{new Date(value(p, 'created_at')).toLocaleString(locale)}</time>
              {((p.files ?? []) as string[]).map((id) => (
                <Attachment key={id} id={id} kind="FILE" t={t} />
              ))}
              <div className="user-actions">
                <button
                  onClick={() =>
                    void act(async () => {
                      const list = await userApi<Row[]>('channels/posts/' + p.id + '/comments');
                      setComments((c) => ({ ...c, [value(p, 'id')]: list }));
                    })
                  }
                >
                  {t.comments}
                </button>
                {!!channel.owner && (
                  <button
                    onClick={() =>
                      void act(async () => {
                        await userApi('channels/posts/' + p.id + '/remove', 'POST', {});
                        await select(value(channel, 'id'));
                      })
                    }
                  >
                    {t.remove}
                  </button>
                )}
              </div>
              {comments[value(p, 'id')]?.map((c) => (
                <div className="communication-comment" key={value(c, 'id')}>
                  <p>{value(c, 'body')}</p>
                  <small>{t[value(c, 'state')] ?? value(c, 'state')}</small>
                  {(channel.owner || admin) &&
                    c.state === 'PENDING' &&
                    ['APPROVED', 'REJECTED'].map((state) => (
                      <button
                        key={state}
                        onClick={() =>
                          void act(async () => {
                            await userApi('channels/comments/' + c.id + '/review', 'POST', {
                              state,
                            });
                            setComments((existing) => ({
                              ...existing,
                              [value(p, 'id')]: existing[value(p, 'id')]!.map((item) =>
                                item.id === c.id ? { ...item, state } : item,
                              ),
                            }));
                          })
                        }
                      >
                        {t[state === 'APPROVED' ? 'approve' : 'reject']}
                      </button>
                    ))}
                </div>
              ))}
              {!!channel.comments_enabled && (
                <form
                  onSubmit={(e) => {
                    const d = fields(e);
                    void act(async () => {
                      await userApi('channels/posts/' + p.id + '/comments', 'POST', {
                        request_key: crypto.randomUUID(),
                        body: d.body,
                      });
                      const list = await userApi<Row[]>('channels/posts/' + p.id + '/comments');
                      setComments((c) => ({ ...c, [value(p, 'id')]: list }));
                    });
                  }}
                >
                  <label>
                    {t.body}
                    <textarea name="body" required maxLength={3000} />
                  </label>
                  <button disabled={busy}>{t.addComment}</button>
                </form>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
export function QuestionWorkspace({ locale, admin = false }: { locale: string; admin?: boolean }) {
  const { t, error, busy, act } = useActions(locale),
    [rows, setRows] = useState<Row[]>([]),
    [publicRows, setPublic] = useState<Row[]>([]);
  const load = async () => {
    setRows(await userApi<Row[]>(admin ? 'questions/admin' : 'questions'));
    setPublic(await userApi<Row[]>('questions/public'));
  };
  useEffect(() => {
    void act(load);
  }, [admin]);
  return (
    <section className="user-card communication-workspace">
      <h2>{t.questions}</h2>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          const d = fields(e);
          void act(async () => {
            await userApi('questions', 'POST', {
              request_key: crypto.randomUUID(),
              question: d.question,
            });
            await load();
          });
        }}
      >
        <label>
          {t.body}
          <textarea name="question" required minLength={3} maxLength={12000} />
        </label>
        <button disabled={busy}>{t.ask}</button>
      </form>
      {rows.map((q) => (
        <article className="communication-post" key={value(q, 'id')}>
          <p>{value(q, admin ? 'public_question' : 'question')}</p>
          <p>{value(q, admin ? 'public_answer' : 'answer')}</p>
          <small>
            {t[value(q, 'visibility')]} · {t[value(q, 'publication')] ?? value(q, 'publication')}
          </small>
          {admin ? (
            <>
              <form
                className="user-actions"
                onSubmit={(e) => {
                  const d = fields(e);
                  void act(async () => {
                    await userApi('questions/' + q.id + '/assign', 'POST', {
                      expert: d.expert,
                      revision: q.revision,
                    });
                    await load();
                  });
                }}
              >
                <label>
                  {t.expertCode}
                  <input name="expert" pattern="[A-Za-z0-9]{13}" required />
                </label>
                <button disabled={busy || !!q.expert_id}>{t.assign}</button>
              </form>
              {q.publication === 'PENDING' &&
                [true, false].map((publish) => (
                  <button
                    key={String(publish)}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await userApi('questions/' + q.id + '/review', 'POST', {
                          publish,
                          revision: q.revision,
                        });
                        await load();
                      })
                    }
                  >
                    {publish ? t.publish : t.reject}
                  </button>
                ))}
            </>
          ) : (
            <>
              {!!q.can_answer && (
                <form
                  onSubmit={(e) => {
                    const d = fields(e);
                    void act(async () => {
                      await userApi('questions/' + q.id + '/answer', 'POST', {
                        answer: d.answer,
                        revision: q.revision,
                      });
                      await load();
                    });
                  }}
                >
                  <label>
                    {t.answer}
                    <textarea name="answer" required maxLength={20000} />
                  </label>
                  <button disabled={busy}>{t.answer}</button>
                </form>
              )}
              {!!q.is_owner && (
                <details>
                  <summary>{t.visibility}</summary>
                  <p>{t.publicationHint}</p>
                  <form
                    className="scholar-form"
                    onSubmit={(e) => {
                      const d = fields(e);
                      void act(async () => {
                        await userApi('questions/' + q.id + '/visibility', 'POST', {
                          visibility: d.visibility,
                          public_question: d.public_question,
                          public_answer: d.public_answer,
                          revision: q.revision,
                        });
                        await load();
                      });
                    }}
                  >
                    <label>
                      {t.visibility}
                      <select name="visibility" defaultValue={value(q, 'visibility')}>
                        {['PRIVATE', 'PUBLIC', 'ANONYMOUS'].map((v) => (
                          <option key={v} value={v}>
                            {t[v]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t.publicQuestion}
                      <textarea name="public_question" maxLength={12000} />
                    </label>
                    <label>
                      {t.publicAnswer}
                      <textarea name="public_answer" maxLength={20000} />
                    </label>
                    <button disabled={busy}>{t.save}</button>
                  </form>
                </details>
              )}
              {!!q.expert_id && (
                <button
                  onClick={() =>
                    void act(async () => {
                      const c = await userApi<Row>(
                        'questions/' + q.id + '/conversation',
                        'POST',
                        {},
                      );
                      location.assign(
                        `${usersBase}/${locale}/account/messages?conversation=${c.id}`,
                      );
                    })
                  }
                >
                  {t.conversation}
                </button>
              )}
            </>
          )}
        </article>
      ))}
      <h3>{t.publicList}</h3>
      {publicRows.map((q) => (
        <article className="communication-post" key={value(q, 'id')}>
          <p>{value(q, 'question')}</p>
          <p>{value(q, 'answer')}</p>
          {!!q.author && <bdi>{value(q, 'author')}</bdi>}
        </article>
      ))}
    </section>
  );
}
export function NotificationWorkspace({
  locale,
  admin = false,
}: {
  locale: string;
  admin?: boolean;
}) {
  const { t, error, busy, act } = useActions(locale),
    [rows, setRows] = useState<Row[]>([]),
    [prefs, setPrefs] = useState<Row | null>(null),
    [settings, setSettings] = useState<Row | null>(null);
  const load = async () => {
    const n = await userApi<{ items: Row[] }>('notifications');
    setRows(n.items);
    setPrefs(await userApi<Row>('notifications/preferences'));
    if (admin) setSettings(await userApi<Row>('notifications/admin'));
  };
  useEffect(() => {
    void act(load);
  }, [admin]);
  return (
    <section className="user-card communication-workspace">
      <h2>{t.notifications}</h2>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => void act(load)}>{t.refresh}</button>
      {rows.map((n) => (
        <article key={value(n, 'id')}>
          <p>{t[value(n, 'event')] ?? t[value(n, 'category')]}</p>
          <time>{new Date(value(n, 'created_at')).toLocaleString(locale)}</time>
          {!n.read_at && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await userApi('notifications/read', 'POST', { ids: [n.id] });
                  await load();
                })
              }
            >
              {t.markRead}
            </button>
          )}
        </article>
      ))}
      {prefs && (
        <details>
          <summary>{t.preferences}</summary>
          <form
            onSubmit={(e) => {
              const d = fields(e),
                preferences = Object.fromEntries(
                  ['BOOKINGS', 'MESSAGES', 'PAYMENTS', 'MARKETING'].map((k) => [
                    k,
                    { email: d[k + '_email'] === 'on', sms: d[k + '_sms'] === 'on' },
                  ]),
                );
              void act(async () => {
                await userApi('notifications/preferences', 'POST', {
                  preferences,
                  locale: locale === 'fa' ? 'fa' : 'en',
                });
                await load();
              });
            }}
          >
            {Object.entries(
              prefs.preferences as Record<string, { email: boolean; sms: boolean }>,
            ).map(([key, p]) => (
              <fieldset key={key}>
                <legend>{t[key]}</legend>
                <label>
                  <input type="checkbox" name={key + '_email'} defaultChecked={p.email} />
                  {t.email}
                </label>
                <label>
                  <input
                    type="checkbox"
                    name={key + '_sms'}
                    defaultChecked={p.sms}
                    disabled={!prefs.phone_verified || !prefs.sms_available}
                  />
                  {t.sms}
                </label>
              </fieldset>
            ))}
            <button disabled={busy}>{t.save}</button>
          </form>
          {prefs.phone_verified ? (
            <p>
              {t.verified} · {value(prefs, 'phone_suffix')}
            </p>
          ) : null}
          {prefs.sms_available ? (
            <form
              className="scholar-form"
              onSubmit={(e) => {
                const d = fields(e);
                void act(async () => {
                  await userApi('notifications/phone', 'POST', {
                    phone: d.phone,
                    ...(d.code ? { code: d.code } : {}),
                  });
                  await load();
                });
              }}
            >
              <label>
                {t.phone}
                <input name="phone" required type="tel" pattern="\+[1-9][0-9]{7,14}" />
              </label>
              <label>
                {t.code}
                <input name="code" inputMode="numeric" pattern="[0-9]{4,10}" />
              </label>
              <button disabled={busy}>
                {t.sendCode} / {t.verify}
              </button>
            </form>
          ) : (
            <p>{t.smsUnavailable}</p>
          )}
        </details>
      )}
      {admin && settings && (
        <details>
          <summary>{t.smsSettings}</summary>
          <p>{t.credentialsHint}</p>
          <form
            className="scholar-form"
            onSubmit={(e) => {
              const d = fields(e);
              void act(async () => {
                const credentials = Object.fromEntries(
                  ['account_sid', 'auth_token', 'messaging_service_sid', 'verify_service_sid'].map(
                    (k) => [k, d[k]],
                  ),
                );
                await userApi('notifications/admin/sms', 'POST', {
                  enabled: d.enabled === 'on',
                  ...(Object.values(credentials).some(Boolean) ? { credentials } : {}),
                });
                await load();
              });
            }}
          >
            {['account_sid', 'auth_token', 'messaging_service_sid', 'verify_service_sid'].map(
              (k) => (
                <label key={k}>
                  {t[k]}
                  <input name={k} type="password" autoComplete="new-password" />
                </label>
              ),
            )}
            <label>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={!!(settings.settings as Row).enabled}
              />
              {t.enabled}
            </label>
            <button disabled={busy}>{t.save}</button>
          </form>
          <ul>
            {((settings.jobs ?? []) as Row[]).map((j, i) => (
              <li key={i}>
                {value(j, 'channel')} · {value(j, 'status')} · {value(j, 'count')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
