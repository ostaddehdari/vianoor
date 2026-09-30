'use client';

import {
  useEffect,
  useState,
} from 'react';

import {
  Icon,
  type IconName,
} from './icons';

import {
  localizedText,
  languageValue,
} from './localization-runtime';

import {
  userApi,
} from './users-client';

type SocialIcon =
  | 'globe'
  | 'comments'
  | 'video'
  | 'mail'
  | 'link'
  | 'share';

export type SocialLink = {
  id: string;
  key: string;

  title: {
    fa: string;
    en: string;
  };

  url: string;

  icon:
    SocialIcon;

  enabled:
    boolean;

  position:
    number;

  revision:
    number;
};

const icons:
  SocialIcon[] = [
    'globe',
    'comments',
    'video',
    'mail',
    'link',
    'share',
  ];

const blank = {
  key: '',
  title: {
    fa: '',
    en: '',
  },
  url: '',
  icon:
    'globe' as SocialIcon,
  enabled: true,
  position: 0,
};

function iconName(
  value: string,
): IconName {
  return icons.includes(
    value as SocialIcon,
  )
    ? (
        value as IconName
      )
    : 'globe';
}

export function PublicSocialLinks({
  locale,
}: {
  locale: string;
}) {
  const [
    links,
    setLinks,
  ] = useState<
    SocialLink[]
  >([]);

  useEffect(() => {
    void userApi<
      SocialLink[]
    >(
      'site-settings/social-links',
    )
      .then(setLinks)
      .catch(() => {});
  }, []);

  if (!links.length)
    return null;

  return (
    <nav
      className="footer-social-links"
      aria-label={localizedText(
        locale,
        'shell.socialNetworks',
        'Social networks',
        'شبکه‌های اجتماعی',
      )}
    >
      {links.map(
        (item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={languageValue(
              item.title,
              locale,
            )}
            title={languageValue(
              item.title,
              locale,
            )}
          >
            <Icon
              name={iconName(
                item.icon,
              )}
            />
          </a>
        ),
      )}
    </nav>
  );
}

export function SocialLinksManager({
  locale,
}: {
  locale: string;
}) {
  const [
    links,
    setLinks,
  ] = useState<
    SocialLink[]
  >([]);

  const [
    edit,
    setEdit,
  ] = useState<
    | SocialLink
    | typeof blank
    | null
  >(null);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState('');

  const [
    notice,
    setNotice,
  ] = useState('');

  const text = (
    key: string,
    en: string,
    fa: string,
  ) =>
    localizedText(
      locale,
      key,
      en,
      fa,
    );

  const refresh =
    async () => {
      setLinks(
        await userApi<
          SocialLink[]
        >(
          'site-settings/social-links?admin=1',
        ),
      );
    };

  useEffect(() => {
    void refresh().catch(
      () => {
        setError(
          text(
            'siteSettings.error',
            'Could not load settings.',
            'تنظیمات بارگذاری نشد.',
          ),
        );
      },
    );
  }, []);

  const save =
    async () => {
      if (!edit)
        return;

      setBusy(true);
      setError('');
      setNotice('');

      try {
        const existing =
          'id' in edit;

        const payload = {
          key:
            edit.key,

          title:
            edit.title,

          url:
            edit.url,

          icon:
            edit.icon,

          enabled:
            edit.enabled,

          position:
            Number(
              edit.position,
            ),

          ...(
            existing
              ? {
                  revision:
                    edit.revision,
                }
              : {}
          ),
        };

        await userApi(
          existing
            ? `site-settings/social-links/${edit.id}`
            : 'site-settings/social-links',

          existing
            ? 'PUT'
            : 'POST',

          payload,
        );

        setEdit(null);

        await refresh();

        setNotice(
          text(
            'siteSettings.saved',
            'Settings saved.',
            'تنظیمات ذخیره شد.',
          ),
        );
      } catch (e) {
        setError(
          text(
            'siteSettings.error',
            'Could not save settings.',
            'ذخیره تنظیمات انجام نشد.',
          ) +
            ' (' +
            (
              e as Error
            ).message +
            ')',
        );
      } finally {
        setBusy(false);
      }
    };

  return (
    <section className="site-settings-manager">
      <div className="panel-heading">
        <div>
          <h3>
            {text(
              'siteSettings.social.title',
              'Social networks',
              'شبکه‌های اجتماعی',
            )}
          </h3>

          <p>
            {text(
              'siteSettings.social.help',
              'Only enabled links appear on public pages.',
              'فقط شبکه‌های فعال در صفحات عمومی نمایش داده می‌شوند.',
            )}
          </p>
        </div>

        <button
          type="button"
          className="button compact"
          onClick={() =>
            setEdit({
              ...blank,
              title: {
                ...blank.title,
              },
            })
          }
        >
          {text(
            'siteSettings.add',
            'Add network',
            'افزودن شبکه',
          )}
        </button>
      </div>

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      {notice && (
        <p role="status">
          {notice}
        </p>
      )}

      {edit && (
        <form
          className="scholar-form user-card"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            {text(
              'siteSettings.key',
              'Key',
              'شناسه',
            )}

            <input
              required
              pattern="[a-z0-9-]+"
              maxLength={40}
              value={
                edit.key
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  key:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {text(
              'siteSettings.faTitle',
              'Persian title',
              'عنوان فارسی',
            )}

            <input
              required
              maxLength={80}
              value={
                edit.title.fa
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  title: {
                    ...edit.title,
                    fa:
                      event.target
                        .value,
                  },
                })
              }
            />
          </label>

          <label>
            {text(
              'siteSettings.enTitle',
              'English title',
              'عنوان انگلیسی',
            )}

            <input
              required
              maxLength={80}
              value={
                edit.title.en
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  title: {
                    ...edit.title,
                    en:
                      event.target
                        .value,
                  },
                })
              }
            />
          </label>

          <label>
            URL

            <input
              required
              type="url"
              value={
                edit.url
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  url:
                    event.target
                      .value,
                })
              }
            />
          </label>

          <label>
            {text(
              'siteSettings.icon',
              'Icon',
              'آیکون',
            )}

            <select
              value={
                edit.icon
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  icon:
                    event.target
                      .value as SocialIcon,
                })
              }
            >
              {icons.map(
                (icon) => (
                  <option
                    key={icon}
                    value={icon}
                  >
                    {icon}
                  </option>
                ),
              )}
            </select>
          </label>

          <label>
            {text(
              'siteSettings.position',
              'Sort order',
              'ترتیب نمایش',
            )}

            <input
              type="number"
              min={0}
              max={10000}
              value={
                edit.position
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  position:
                    Number(
                      event.target
                        .value,
                    ),
                })
              }
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={
                edit.enabled
              }
              onChange={(event) =>
                setEdit({
                  ...edit,
                  enabled:
                    event.target
                      .checked,
                })
              }
            />

            {text(
              'siteSettings.enabled',
              'Enabled',
              'فعال',
            )}
          </label>

          <div className="button-row">
            <button
              className="button compact"
              disabled={busy}
            >
              {text(
                'siteSettings.save',
                'Save',
                'ذخیره',
              )}
            </button>

            <button
              className="button compact secondary"
              type="button"
              onClick={() =>
                setEdit(null)
              }
            >
              {text(
                'siteSettings.cancel',
                'Cancel',
                'انصراف',
              )}
            </button>
          </div>
        </form>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                {text(
                  'siteSettings.network',
                  'Network',
                  'شبکه',
                )}
              </th>

              <th>URL</th>

              <th>
                {text(
                  'siteSettings.status',
                  'Status',
                  'وضعیت',
                )}
              </th>

              <th>
                {text(
                  'siteSettings.position',
                  'Sort order',
                  'ترتیب',
                )}
              </th>

              <th>
                {text(
                  'siteSettings.edit',
                  'Edit',
                  'ویرایش',
                )}
              </th>
            </tr>
          </thead>

          <tbody>
            {links.map(
              (item) => (
                <tr key={item.id}>
                  <td>
                    <span className="social-admin-name">
                      <Icon
                        name={iconName(
                          item.icon,
                        )}
                      />

                      {languageValue(
                        item.title,
                        locale,
                      )}
                    </span>
                  </td>

                  <td>
                    <bdi>
                      {item.url}
                    </bdi>
                  </td>

                  <td>
                    {item.enabled
                      ? text(
                          'siteSettings.active',
                          'Active',
                          'فعال',
                        )
                      : text(
                          'siteSettings.inactive',
                          'Inactive',
                          'غیرفعال',
                        )}
                  </td>

                  <td>
                    {item.position}
                  </td>

                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        setEdit({
                          ...item,
                          title: {
                            ...item.title,
                          },
                        })
                      }
                    >
                      {text(
                        'siteSettings.edit',
                        'Edit',
                        'ویرایش',
                      )}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
