'use client';

import {
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

import {
  Icon,
} from './icons';

export function DashboardDrawer({
  open,
  title,
  closeLabel,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;

  title: string;

  closeLabel: string;

  onClose: () => void;

  children: ReactNode;

  wide?: boolean | undefined;
}) {
  const closeRef =
    useRef<HTMLButtonElement>(
      null,
    );

  useEffect(
    () => {
      if (!open)
        return;

      const previous =
        document.activeElement as
          | HTMLElement
          | null;

      const oldOverflow =
        document.body.style
          .overflow;

      document.body.style.overflow =
        'hidden';

      const timer =
        window.setTimeout(
          () =>
            closeRef.current?.focus(),
          20,
        );

      const keyboard =
        (
          event: KeyboardEvent,
        ) => {
          if (
            event.key ===
            'Escape'
          )
            onClose();
        };

      window.addEventListener(
        'keydown',
        keyboard,
      );

      return () => {
        window.clearTimeout(
          timer,
        );

        window.removeEventListener(
          'keydown',
          keyboard,
        );

        document.body.style.overflow =
          oldOverflow;

        previous?.focus();
      };
    },
    [
      open,
      onClose,
    ],
  );

  if (!open)
    return null;

  return (
    <div className="dash22-drawer-layer">
      <button
        type="button"
        className="dash22-drawer-backdrop"
        aria-label={
          closeLabel
        }
        onClick={
          onClose
        }
      />

      <aside
        className={`dash22-drawer-panel${
          wide
            ? ' is-wide'
            : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={
          title
        }
      >
        <header className="dash22-drawer-header">
          <div>
            <span
              className="dash22-drawer-kicker"
              aria-hidden="true"
            >
              <Icon name="sparkles" />
            </span>

            <h2>
              {title}
            </h2>
          </div>

          <button
            ref={
              closeRef
            }
            type="button"
            className="dash22-drawer-close-button"
            aria-label={
              closeLabel
            }
            onClick={
              onClose
            }
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="dash22-drawer-content">
          {children}
        </div>
      </aside>
    </div>
  );
}
