'use client';
import { useEffect, useRef, useState } from 'react';
import { userApi, usersBase } from './users-client';
import { communicationCopy } from './communication-copy';
type Notice = {
  id: string;
  event: string;
  category: string;
  context_id: string;
  read_at: string | null;
  created_at: string;
};
type Summary = { id: string; type: string; unread: number };
export function CommunicationCenter({ locale }: { locale: string }) {
  const t = communicationCopy[locale]!,
    [messages, setMessages] = useState<Summary[]>([]),
    [notifications, setNotifications] = useState<Notice[]>([]),
    [count, setCount] = useState(0),
    socket = useRef<WebSocket | null>(null);
  useEffect(() => {
    let disposed = false,
      retry: ReturnType<typeof setTimeout> | undefined,
      refresh: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const [m, n] = await Promise.all([
        userApi<Summary[]>('communications/conversations'),
        userApi<{ items: Notice[]; unread: number }>('notifications'),
      ]);
      if (!disposed) {
        setMessages(m.filter((x) => x.unread > 0));
        setNotifications(n.items.filter((x) => !x.read_at).slice(0, 5));
        setCount(n.unread);
      }
    };
    const connect = async () => {
      try {
        const d = await userApi<{ ticket: string }>('communications/realtime-ticket', 'POST', {});
        if (disposed) return;
        const ws = new WebSocket(
          (location.protocol === 'https:' ? 'wss://' : 'ws://') +
            location.host +
            usersBase +
            '/realtime',
        );
        socket.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', ticket: d.ticket }));
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(String(e.data));
            window.dispatchEvent(new CustomEvent('vianoor:communication', { detail: data }));
            if (['message', 'notification', 'ready'].includes(data.type)) {
              clearTimeout(refresh);
              refresh = setTimeout(() => void load().catch(() => {}), 300);
            }
          } catch {
            /* Ignore malformed transient updates. */
          }
        };
        ws.onclose = () => {
          socket.current = null;
          if (!disposed) retry = setTimeout(() => void connect(), 4000);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!disposed) retry = setTimeout(() => void connect(), 8000);
      }
    };
    void load().catch(() => {});
    void connect();
    const heartbeat = setInterval(() => {
        const ws = socket.current;
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({ type: 'heartbeat', state: document.hidden ? 'AWAY' : 'ONLINE' }),
          );
      }, 25000),
      poll = setInterval(() => void load().catch(() => {}), 30000);
    const typing = (e: Event) => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'typing', ...(e as CustomEvent).detail }));
    };
    window.addEventListener('vianoor:typing', typing);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(refresh);
      clearInterval(heartbeat);
      clearInterval(poll);
      window.removeEventListener('vianoor:typing', typing);
      socket.current?.close();
    };
  }, []);
  return (
    <div className="communication-center">
      <details className="dashboard-account-menu">
        <summary>
          {t.messages} ({messages.reduce((n, m) => n + m.unread, 0)})
        </summary>
        <div className="dashboard-account-popover">
          {messages.slice(0, 5).map((m) => (
            <a key={m.id} href={`${usersBase}/${locale}/account/messages?conversation=${m.id}`}>
              {t[m.type as keyof typeof t] ?? t.messages} ({m.unread})
            </a>
          ))}
          <a href={`${usersBase}/${locale}/account/messages`}>{t.messages}</a>
        </div>
      </details>
      <details className="dashboard-account-menu">
        <summary>
          {t.notifications} ({count})
        </summary>
        <div className="dashboard-account-popover">
          {notifications.map((n) => (
            <a key={n.id} href={`${usersBase}/${locale}/account/notifications`}>
              {t[n.event as keyof typeof t] ?? t.notifications}
            </a>
          ))}
          <a href={`${usersBase}/${locale}/account/notifications`}>{t.notifications}</a>
        </div>
      </details>
    </div>
  );
}
