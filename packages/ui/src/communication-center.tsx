'use client';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  userApi,
  usersBase,
} from './users-client';

import {
  communicationCopy,
} from './communication-copy';

import {
  Icon,
} from './icons';

type Notice = {
  id: string;
  event: string;
  category: string;
  context_id: string;
  read_at: string | null;
  created_at: string;
};

type Summary = {
  id: string;
  type: string;
  unread: number;
};

function queryHref(
  base: string,
  name: string,
  value: string,
) {
  return (
    base +
    (
      base.includes('?')
        ? '&'
        : '?'
    ) +
    encodeURIComponent(name) +
    '=' +
    encodeURIComponent(value)
  );
}

export function CommunicationCenter({
  locale,
  compact = false,
  messageHref,
  notificationHref,
}: {
  locale: string;

  compact?: boolean;

  messageHref?: string;

  notificationHref?: string;
}) {
  const t =
    communicationCopy[locale]!;

  const [
    messages,
    setMessages,
  ] =
    useState<Summary[]>([]);

  const [
    notifications,
    setNotifications,
  ] =
    useState<Notice[]>([]);

  const [
    count,
    setCount,
  ] =
    useState(0);

  const socket =
    useRef<WebSocket | null>(
      null,
    );

  useEffect(() => {
    let disposed =
        false,
      retry:
        | ReturnType<
            typeof setTimeout
          >
        | undefined,
      refresh:
        | ReturnType<
            typeof setTimeout
          >
        | undefined;

    const load =
      async () => {
        const [
          m,
          n,
        ] =
          await Promise.all([
            userApi<Summary[]>(
              'communications/conversations',
            ),

            userApi<{
              items: Notice[];
              unread: number;
            }>(
              'notifications',
            ),
          ]);

        if (
          !disposed
        ) {
          setMessages(
            m.filter(
              (
                item,
              ) =>
                item.unread >
                0,
            ),
          );

          setNotifications(
            n.items
              .filter(
                (
                  item,
                ) =>
                  !item.read_at,
              )
              .slice(
                0,
                5,
              ),
          );

          setCount(
            n.unread,
          );
        }
      };

    const connect =
      async () => {
        try {
          const data =
            await userApi<{
              ticket: string;
            }>(
              'communications/realtime-ticket',
              'POST',
              {},
            );

          if (
            disposed
          )
            return;

          const ws =
            new WebSocket(
              (
                location.protocol ===
                'https:'
                  ? 'wss://'
                  : 'ws://'
              ) +
                location.host +
                usersBase +
                '/realtime',
            );

          socket.current =
            ws;

          ws.onopen =
            () =>
              ws.send(
                JSON.stringify({
                  type:
                    'authenticate',

                  ticket:
                    data.ticket,
                }),
              );

          ws.onmessage =
            (
              event,
            ) => {
              try {
                const data =
                  JSON.parse(
                    String(
                      event.data,
                    ),
                  );

                window.dispatchEvent(
                  new CustomEvent(
                    'vianoor:communication',
                    {
                      detail:
                        data,
                    },
                  ),
                );

                if (
                  [
                    'message',
                    'notification',
                    'ready',
                  ].includes(
                    data.type,
                  )
                ) {
                  clearTimeout(
                    refresh,
                  );

                  refresh =
                    setTimeout(
                      () =>
                        void load().catch(
                          () => {},
                        ),
                      300,
                    );
                }
              } catch {
                /* transient malformed event */
              }
            };

          ws.onclose =
            () => {
              socket.current =
                null;

              if (
                !disposed
              )
                retry =
                  setTimeout(
                    () =>
                      void connect(),
                    4000,
                  );
            };

          ws.onerror =
            () =>
              ws.close();
        } catch {
          if (
            !disposed
          )
            retry =
              setTimeout(
                () =>
                  void connect(),
                8000,
              );
        }
      };

    void load().catch(
      () => {},
    );

    void connect();

    const heartbeat =
      setInterval(
        () => {
          const ws =
            socket.current;

          if (
            ws?.readyState ===
            WebSocket.OPEN
          )
            ws.send(
              JSON.stringify({
                type:
                  'heartbeat',

                state:
                  document.hidden
                    ? 'AWAY'
                    : 'ONLINE',
              }),
            );
        },
        25000,
      );

    const poll =
      setInterval(
        () =>
          void load().catch(
            () => {},
          ),
        30000,
      );

    const typing =
      (
        event: Event,
      ) => {
        const ws =
          socket.current;

        if (
          ws?.readyState ===
          WebSocket.OPEN
        )
          ws.send(
            JSON.stringify({
              type:
                'typing',

              ...(
                event as CustomEvent
              ).detail,
            }),
          );
      };

    window.addEventListener(
      'vianoor:typing',
      typing,
    );

    return () => {
      disposed =
        true;

      clearTimeout(
        retry,
      );

      clearTimeout(
        refresh,
      );

      clearInterval(
        heartbeat,
      );

      clearInterval(
        poll,
      );

      window.removeEventListener(
        'vianoor:typing',
        typing,
      );

      socket.current?.close();
    };
  }, []);

  const unreadMessages =
    messages.reduce(
      (
        total,
        message,
      ) =>
        total +
        message.unread,
      0,
    );

  const messagesBase =
    messageHref ??
    `${usersBase}/${locale}/account/messages`;

  const notificationsBase =
    notificationHref ??
    `${usersBase}/${locale}/account/notifications`;

  return (
    <div
      className={`communication-center${
        compact
          ? ' communication-center-compact'
          : ''
      }`}
    >
      <details className="dashboard-account-menu communication-menu">
        <summary
          className={
            compact
              ? 'dash22-communication-button'
              : ''
          }
          aria-label={`${t.messages}: ${unreadMessages}`}
        >
          {compact ? (
            <>
              <Icon name="mail" />

              <span className="sr-only">
                {t.messages}
              </span>

              {unreadMessages >
                0 && (
                <span className="dash22-counter">
                  {unreadMessages >
                  99
                    ? '99+'
                    : unreadMessages}
                </span>
              )}
            </>
          ) : (
            <>
              {t.messages}{' '}
              ({unreadMessages})
            </>
          )}
        </summary>

        <div className="dashboard-account-popover">
          {messages
            .slice(
              0,
              5,
            )
            .map(
              (
                message,
              ) => (
                <a
                  key={
                    message.id
                  }
                  href={queryHref(
                    messagesBase,
                    'conversation',
                    message.id,
                  )}
                >
                  {t[
                    message.type as keyof typeof t
                  ] ??
                    t.messages}{' '}
                  ({message.unread})
                </a>
              ),
            )}

          <a
            href={
              messagesBase
            }
          >
            {t.messages}
          </a>
        </div>
      </details>

      <details className="dashboard-account-menu communication-menu">
        <summary
          className={
            compact
              ? 'dash22-communication-button'
              : ''
          }
          aria-label={`${t.notifications}: ${count}`}
        >
          {compact ? (
            <>
              <Icon name="bell" />

              <span className="sr-only">
                {t.notifications}
              </span>

              {count >
                0 && (
                <span className="dash22-counter">
                  {count >
                  99
                    ? '99+'
                    : count}
                </span>
              )}
            </>
          ) : (
            <>
              {t.notifications}{' '}
              ({count})
            </>
          )}
        </summary>

        <div className="dashboard-account-popover">
          {notifications.map(
            (
              notice,
            ) => (
              <a
                key={
                  notice.id
                }
                href={
                  notificationsBase
                }
              >
                {t[
                  notice.event as keyof typeof t
                ] ??
                  t.notifications}
              </a>
            ),
          )}

          <a
            href={
              notificationsBase
            }
          >
            {t.notifications}
          </a>
        </div>
      </details>
    </div>
  );
}
