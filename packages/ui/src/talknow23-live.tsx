'use client';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  userApi,
} from './users-client';

import {
  talkNow23Copy,
} from './talknow23-copy';

type JoinData = {
  request: {
    id: string;
    mode:
      | 'AUDIO'
      | 'VIDEO';
    status: string;
  };

  conversation_id: string;

  media: {
    token: string;
    url: string;

    role:
      | 'CLIENT'
      | 'EXPERT';

    capabilities: {
      microphone: boolean;
      camera: boolean;
      screen: boolean;
      subscribe: boolean;
      text_chat: boolean;
    };
  };
};

type Message = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type MessagePage = {
  messages: Message[];
};

export function TalkNowLive({
  locale,
  requestId,
  onBack,
}: {
  locale: string;

  requestId: string;

  onBack:
    () => void;
}) {
  const t =
    talkNow23Copy[
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

  async function loadMessages(
    conversationId:
      string,
  ) {
    const value =
      await userApi<
        MessagePage
      >(
        `communications/conversations/${conversationId}/messages?limit=100`,
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
          `instant/requests/${requestId}/join`,
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
          const element =
            track.attach();

          element.dataset.participant =
            identity;

          tiles.current
            ?.appendChild(
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
        track =>
          track
            .detach()
            .forEach(
              element =>
                element.remove(),
            ),
      );

      instance.on(
        sdk.RoomEvent.LocalTrackPublished,
        publication => {
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
        publication =>
          publication.track
            ?.detach()
            .forEach(
              element =>
                element.remove(),
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

      await loadMessages(
        result.conversation_id,
      );
    } catch {
      setError(
        t.error,
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

    tiles.current
      ?.replaceChildren();
  }

  async function endSession() {
    if (
      joined?.media.role !==
      'EXPERT'
    )
      return;

    await userApi(
      `instant/requests/${requestId}/end`,
      'POST',
      {},
    );

    await disconnect();

    onBack();
  }

  async function toggleMic() {
    const current =
      room.current;

    if (!current)
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
      !joined?.media
        .capabilities
        .camera
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
      !joined?.media
        .capabilities
        .screen
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

  async function sendMessage() {
    if (
      !joined ||
      !message.trim()
    )
      return;

    await userApi(
      `communications/conversations/${joined.conversation_id}/messages`,
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

    await loadMessages(
      joined.conversation_id,
    );
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
      if (!joined)
        return;

      const timer =
        window.setInterval(
          () => {
            void loadMessages(
              joined.conversation_id,
            ).catch(
              () => {},
            );
          },
          3500,
        );

      return () =>
        window.clearInterval(
          timer,
        );
    },
    [
      joined?.conversation_id,
    ],
  );

  return (
    <section className="talk23-live">
      <header>
        <div>
          <small>
            {t.room}
          </small>

          <strong>
            {joined?.request.mode ??
              ''}
          </strong>
        </div>

        <button
          type="button"
          onClick={() => {
            void disconnect()
              .then(
                onBack,
              );
          }}
        >
          {t.leave}
        </button>
      </header>

      {error && (
        <p
          className="talk23-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {!joined ? (
        <div className="talk23-connect">
          <h2>
            {t.room}
          </h2>

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
        </div>
      ) : (
        <div className="talk23-live-grid">
          <div className="talk23-call">
            <div
              ref={
                tiles
              }
              className={
                joined.request
                  .mode ===
                'AUDIO'
                  ? 'talk23-media audio'
                  : 'talk23-media'
              }
            />

            <div className="talk23-call-controls">
              <button
                type="button"
                onClick={() =>
                  void toggleMic()
                }
              >
                {mic
                  ? t.micOff
                  : t.micOn}
              </button>

              {joined.media
                .capabilities
                .camera && (
                <button
                  type="button"
                  onClick={() =>
                    void toggleCamera()
                  }
                >
                  {camera
                    ? t.cameraOff
                    : t.cameraOn}
                </button>
              )}

              {joined.media
                .capabilities
                .screen && (
                <button
                  type="button"
                  onClick={() =>
                    void toggleScreen()
                  }
                >
                  {screen
                    ? t.screenOff
                    : t.screenOn}
                </button>
              )}

              {joined.media.role ===
                'EXPERT' && (
                <button
                  type="button"
                  className="talk23-danger"
                  onClick={() =>
                    void endSession()
                  }
                >
                  {t.endSession}
                </button>
              )}
            </div>
          </div>

          <aside className="talk23-chat">
            <h3>
              {t.chat}
            </h3>

            <div className="talk23-chat-history">
              {messages.length ? (
                messages.map(
                  item => (
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

            <form
              onSubmit={event => {
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
                  t.chatPlaceholder
                }
                onChange={event =>
                  setMessage(
                    event.target.value,
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
          </aside>
        </div>
      )}
    </section>
  );
}
