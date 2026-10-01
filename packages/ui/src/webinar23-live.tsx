'use client';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Icon,
} from './icons';

import {
  userApi,
} from './users-client';

import {
  events23Copy,
} from './events23-copy';

type JoinData = {
  event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    presenter_code: string;
    chat_enabled: boolean;
    qna_enabled: boolean;
    raise_hand_enabled: boolean;
  };

  role:
    | 'PRESENTER'
    | 'MODERATOR'
    | 'SPONSOR'
    | 'ATTENDEE';

  chat_conversation_id:
    | string
    | null;

  media: {
    token: string;
    url: string;
    expires_in: number;
    identity: string;
    role: string;

    capabilities: {
      microphone: boolean;
      camera: boolean;
      screen: boolean;
      subscribe: boolean;
      text_chat: boolean;
    };
  };
};

type Me = {
  event_id: string;
  event_status: string;
  role: string;
  microphone_allowed: boolean;
  camera_allowed: boolean;
  screen_allowed: boolean;
  raised_hand: boolean;
  joined_at: string | null;
  chat_enabled: boolean;
  qna_enabled: boolean;
  raise_hand_enabled: boolean;
};

type Participant = {
  account_code: string;
  role: string;
  status: string;
  media_identity: string;
  microphone_allowed: boolean;
  camera_allowed: boolean;
  raised_hand: boolean;
  joined_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  sender_id: string;
  sequence: string;
  type: string;
  content: string;
  created_at: string;
};

type MessagePage = {
  messages: Message[];
  next: string;
};

export function WebinarLiveRoom({
  locale,
  eventId,
  onBack,
}: {
  locale: string;

  eventId: string;

  onBack:
    () => void;
}) {
  const t =
    events23Copy[
      locale
    ]!;

  const room =
    useRef<
      import(
        'livekit-client'
      ).Room | null
    >(null);

  const tiles =
    useRef<
      HTMLDivElement | null
    >(null);

  const [
    joined,
    setJoined,
  ] =
    useState<
      JoinData | null
    >(null);

  const [
    me,
    setMe,
  ] =
    useState<
      Me | null
    >(null);

  const [
    participants,
    setParticipants,
  ] =
    useState<
      Participant[]
    >([]);

  const [
    messages,
    setMessages,
  ] =
    useState<
      Message[]
    >([]);

  const [
    message,
    setMessage,
  ] =
    useState('');

  const [
    mic,
    setMic,
  ] =
    useState(false);

  const [
    camera,
    setCamera,
  ] =
    useState(false);

  const [
    screen,
    setScreen,
  ] =
    useState(false);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

  const [
    connection,
    setConnection,
  ] =
    useState(
      'disconnected',
    );

  async function loadMe() {
    const value =
      await userApi<Me>(
        `events/${eventId}/me`,
      );

    setMe(
      value,
    );

    const current =
      room.current;

    if (
      current
    ) {
      if (
        !value.microphone_allowed &&
        current
          .localParticipant
          .isMicrophoneEnabled
      ) {
        await current
          .localParticipant
          .setMicrophoneEnabled(
            false,
          );

        setMic(
          false,
        );
      }

      if (
        !value.camera_allowed &&
        current
          .localParticipant
          .isCameraEnabled
      ) {
        await current
          .localParticipant
          .setCameraEnabled(
            false,
          );

        setCamera(
          false,
        );
      }
    }

    return value;
  }

  async function loadParticipants() {
    if (
      joined?.role !==
      'PRESENTER'
    )
      return;

    setParticipants(
      await userApi<
        Participant[]
      >(
        `events/${eventId}/participants`,
      ),
    );
  }

  async function loadMessages() {
    const conversation =
      joined
        ?.chat_conversation_id;

    if (
      !conversation
    )
      return;

    const value =
      await userApi<
        MessagePage
      >(
        `communications/conversations/${conversation}/messages?limit=100`,
      );

    setMessages(
      value.messages,
    );
  }

  async function connect() {
    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const result =
        await userApi<
          JoinData
        >(
          `events/${eventId}/join`,
          'POST',
          {},
        );

      const sdk =
        await import(
          'livekit-client'
        );

      await room.current
        ?.disconnect();

      tiles.current
        ?.replaceChildren();

      const instance =
        new sdk.Room({
          adaptiveStream:
            true,

          dynacast:
            true,
        });

      room.current =
        instance;

      const attach =
        (
          track:
            import(
              'livekit-client'
            ).Track,
          identity:
            string,
        ) => {
          if (
            !tiles.current
          )
            return;

          const element =
            track.attach();

          element.dataset.participant =
            identity;

          tiles.current.appendChild(
            element,
          );
        };

      instance.on(
        sdk.RoomEvent.TrackSubscribed,
        (
          track,
          _publication,
          participant,
        ) =>
          attach(
            track,
            participant.identity,
          ),
      );

      instance.on(
        sdk.RoomEvent.TrackUnsubscribed,
        (
          track,
        ) =>
          track
            .detach()
            .forEach(
              (
                element,
              ) =>
                element.remove(),
            ),
      );

      instance.on(
        sdk.RoomEvent.LocalTrackPublished,
        (
          publication,
        ) => {
          const track =
            publication.track;

          if (
            !track ||
            track.kind !==
              'video'
          )
            return;

          const element =
            track.attach();

          element.muted =
            true;

          element.dataset.participant =
            'local';

          tiles.current
            ?.appendChild(
              element,
            );
        },
      );

      instance.on(
        sdk.RoomEvent.LocalTrackUnpublished,
        (
          publication,
        ) =>
          publication.track
            ?.detach()
            .forEach(
              (
                element,
              ) =>
                element.remove(),
            ),
      );

      instance.on(
        sdk.RoomEvent.ConnectionStateChanged,
        (
          state,
        ) =>
          setConnection(
            String(
              state,
            ),
          ),
      );

      await instance.connect(
        result.media.url,
        result.media.token,
      );

      await instance.startAudio();

      if (
        result.media
          .capabilities
          .microphone
      ) {
        await instance
          .localParticipant
          .setMicrophoneEnabled(
            true,
          );

        setMic(
          true,
        );
      }

      if (
        result.media
          .capabilities
          .camera
      ) {
        await instance
          .localParticipant
          .setCameraEnabled(
            true,
          );

        setCamera(
          true,
        );
      }

      setJoined(
        result,
      );

      await Promise.all([
        loadMe(),

        result.role ===
          'PRESENTER'
          ? userApi<
              Participant[]
            >(
              `events/${eventId}/participants`,
            ).then(
              setParticipants,
            )
          : Promise.resolve(),

        result
          .chat_conversation_id
          ? userApi<
              MessagePage
            >(
              `communications/conversations/${result.chat_conversation_id}/messages?limit=100`,
            ).then(
              (
                value,
              ) =>
                setMessages(
                  value.messages,
                ),
            )
          : Promise.resolve(),
      ]);
    } catch (
      exception
    ) {
      const code =
        exception instanceof
        Error
          ? exception.message
          : '';

      setError(
        code ===
          'PRESENTER_HAS_NOT_STARTED'
          ? t.waitingPresenter
          : t.error,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  async function disconnect() {
    await room.current
      ?.disconnect();

    room.current =
      null;

    setJoined(
      null,
    );

    setMic(
      false,
    );

    setCamera(
      false,
    );

    setScreen(
      false,
    );

    setConnection(
      'disconnected',
    );

    tiles.current
      ?.replaceChildren();
  }

  async function toggleMic() {
    const current =
      room.current;

    if (
      !current ||
      !me?.microphone_allowed
    )
      return;

    const next =
      !mic;

    await current
      .localParticipant
      .setMicrophoneEnabled(
        next,
      );

    setMic(
      next,
    );
  }

  async function toggleCamera() {
    const current =
      room.current;

    if (
      !current ||
      !me?.camera_allowed
    )
      return;

    const next =
      !camera;

    await current
      .localParticipant
      .setCameraEnabled(
        next,
      );

    setCamera(
      next,
    );
  }

  async function toggleScreen() {
    const current =
      room.current;

    if (
      !current ||
      joined?.role !==
        'PRESENTER'
    )
      return;

    const next =
      !screen;

    await current
      .localParticipant
      .setScreenShareEnabled(
        next,
      );

    setScreen(
      next,
    );
  }

  async function raiseHand() {
    if (
      !me
    )
      return;

    await userApi(
      `events/${eventId}/raise-hand`,
      'POST',
      {
        raised:
          !me.raised_hand,
      },
    );

    await loadMe();
  }

  async function grant(
    participant:
      Participant,
    field:
      'microphone'
      | 'camera',
  ) {
    await userApi(
      `events/${eventId}/grant`,
      'POST',
      {
        account:
          participant
            .account_code,

        microphone:
          field ===
            'microphone'
            ? !participant
                .microphone_allowed
            : participant
                .microphone_allowed,

        camera:
          field ===
            'camera'
            ? !participant
                .camera_allowed
            : participant
                .camera_allowed,
      },
    );

    await loadParticipants();
  }

  async function sendMessage() {
    const conversation =
      joined
        ?.chat_conversation_id;

    if (
      !conversation ||
      !message.trim()
    )
      return;

    await userApi(
      `communications/conversations/${conversation}/messages`,
      'POST',
      {
        request_key:
          crypto.randomUUID(),

        type:
          'TEXT',

        content:
          message.trim(),

        reply_to:
          null,

        files:
          [],
      },
    );

    setMessage(
      '',
    );

    await loadMessages();
  }

  useEffect(
    () => {
      return () => {
        void room.current
          ?.disconnect();
      };
    },
    [],
  );

  useEffect(
    () => {
      if (
        !joined
      )
        return;

      const timer =
        window.setInterval(
          () => {
            void loadMe()
              .catch(
                () => {},
              );

            void loadMessages()
              .catch(
                () => {},
              );

            if (
              joined.role ===
              'PRESENTER'
            )
              void loadParticipants()
                .catch(
                  () => {},
                );
          },
          4000,
        );

      return () =>
        window.clearInterval(
          timer,
        );
    },
    [
      joined
        ?.role,
      joined
        ?.chat_conversation_id,
    ],
  );

  return (
    <main
      className="webinar23-live"
      id="main"
      tabIndex={-1}
    >
      <header className="webinar23-live-header">
        <button
          type="button"
          onClick={
            onBack
          }
        >
          {t.back}
        </button>

        <div>
          <span>
            {t.webinarRoom}
          </span>

          <strong>
            {joined
              ?.event
              .title ??
              eventId}
          </strong>
        </div>

        <span className="webinar23-connection">
          {connection}
        </span>
      </header>

      {error && (
        <p
          role="alert"
          className="webinar23-error"
        >
          {error}
        </p>
      )}

      {!joined ? (
        <section className="webinar23-connect-card">
          <Icon name="video" />

          <h1>
            {t.webinarRoom}
          </h1>

          <p>
            {t.permissionHint}
          </p>

          <button
            type="button"
            className="button"
            disabled={
              busy
            }
            onClick={() =>
              void connect()
            }
          >
            {busy
              ? t.connecting
              : t.connect}
          </button>
        </section>
      ) : (
        <div className="webinar23-live-layout">
          <section className="webinar23-stage">
            <div
              ref={
                tiles
              }
              className="webinar23-media-grid"
            />

            <div className="webinar23-controls">
              <button
                type="button"
                disabled={
                  !me
                    ?.microphone_allowed
                }
                onClick={() =>
                  void toggleMic()
                }
              >
                {mic
                  ? t.micOff
                  : t.micOn}
              </button>

              <button
                type="button"
                disabled={
                  !me
                    ?.camera_allowed
                }
                onClick={() =>
                  void toggleCamera()
                }
              >
                {camera
                  ? t.cameraOff
                  : t.cameraOn}
              </button>

              {joined.role ===
                'PRESENTER' && (
                <button
                  type="button"
                  onClick={() =>
                    void toggleScreen()
                  }
                >
                  {screen
                    ? t.stopScreen
                    : t.shareScreen}
                </button>
              )}

              {joined.role !==
                'PRESENTER' &&
                me
                  ?.raise_hand_enabled && (
                <button
                  type="button"
                  onClick={() =>
                    void raiseHand()
                  }
                >
                  {me.raised_hand
                    ? t.handDown
                    : t.handUp}
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  void disconnect()
                }
              >
                {t.leave}
              </button>
            </div>

            {joined.role ===
              'PRESENTER' && (
              <section className="webinar23-participant-control">
                <div className="webinar23-section-title">
                  <h2>
                    {t.participants}
                  </h2>

                  <button
                    type="button"
                    onClick={() =>
                      void loadParticipants()
                    }
                  >
                    {t.refresh}
                  </button>
                </div>

                <div className="webinar23-participant-list">
                  {participants.map(
                    (
                      participant,
                    ) => (
                      <article
                        key={
                          participant.account_code
                        }
                        className={
                          participant.raised_hand
                            ? 'raised'
                            : ''
                        }
                      >
                        <div>
                          <strong>
                            <bdi>
                              {participant.account_code}
                            </bdi>
                          </strong>

                          <small>
                            {participant.role}
                            {participant.raised_hand
                              ? ` · ${t.raisedHand}`
                              : ''}
                          </small>
                        </div>

                        {participant.role !==
                          'PRESENTER' && (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                void grant(
                                  participant,
                                  'microphone',
                                )
                              }
                            >
                              {t.microphone}:{' '}
                              {participant.microphone_allowed
                                ? t.revoke
                                : t.grant}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void grant(
                                  participant,
                                  'camera',
                                )
                              }
                            >
                              {t.camera}:{' '}
                              {participant.camera_allowed
                                ? t.revoke
                                : t.grant}
                            </button>
                          </div>
                        )}
                      </article>
                    ),
                  )}
                </div>
              </section>
            )}
          </section>

          <aside className="webinar23-chat">
            <h2>
              {t.webinarChat}
            </h2>

            <div className="webinar23-chat-messages">
              {messages.length ? (
                messages.map(
                  (
                    item,
                  ) => (
                    <article
                      key={
                        item.id
                      }
                    >
                      <bdi>
                        {item.sender_id}
                      </bdi>

                      <p>
                        {item.content}
                      </p>

                      <time
                        dateTime={
                          item.created_at
                        }
                      >
                        {new Date(
                          item.created_at,
                        ).toLocaleTimeString(
                          locale,
                        )}
                      </time>
                    </article>
                  ),
                )
              ) : (
                <p>
                  {t.noMessages}
                </p>
              )}
            </div>

            {joined
              .chat_conversation_id && (
              <form
                onSubmit={(
                  event,
                ) => {
                  event.preventDefault();

                  void sendMessage();
                }}
              >
                <textarea
                  value={
                    message
                  }
                  maxLength={
                    12000
                  }
                  placeholder={
                    t.message
                  }
                  onChange={(
                    event,
                  ) =>
                    setMessage(
                      event
                        .target
                        .value,
                    )
                  }
                />

                <button
                  className="button"
                  disabled={
                    !message.trim()
                  }
                >
                  {t.send}
                </button>
              </form>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
