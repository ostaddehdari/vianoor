'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Icon,
} from './icons';

import {
  languageValue,
} from './localization-runtime';

import {
  userApi,
  usersBase,
} from './users-client';

import {
  qna23Copy,
} from './qna23-copy';

type Taxon = {
  id: string;

  kind:
    | 'specialty'
    | 'category'
    | 'language';

  label: {
    fa?: string;
    en: string;

    [key: string]:
      | string
      | undefined;
  };

  active: boolean;
};

type Language = {
  code: string;
  native_name: string | null;
  name_en: string;
};

type PublicQuestion = {
  id: string;
  title: string;
  question: string;
  legacy_answer?: string | null;
  author: string | null;
  category_id: string | null;
  tags: string[];
  language: string;
  views: number;
  accepted_answer_id: string | null;
  answer_count: number;
  comment_count: number;
  answered: boolean;
  created_at: string;
  updated_at: string;
};

type Feed = {
  items: PublicQuestion[];
  next_offset: number | null;
};

type Comment = {
  id: string;
  question_id: string;
  answer_id: string | null;
  author_code: string;
  body: string;
  created_at: string;
};

type PublicAnswer = {
  id: string | null;
  body: string | null;
  author: string | null;
  accepted: boolean;
  created_at: string;
  comments: Comment[];
};

type Translation = {
  language: string;
  title: string;
  question: string;
  accepted_answer: string | null;
  updated_at: string;
};

type Detail = {
  question: {
    id: string;
    title: string;
    body: string;
    author: string | null;
    category_id: string | null;
    tags: string[];
    language: string;
    views: number;
    created_at: string;
    updated_at: string;
    accepted_answer_id: string | null;
    comments: Comment[];
  };

  answers: PublicAnswer[];

  translation: Translation | null;
};

type Mine = {
  id: string;
  is_owner: boolean;
  can_answer: boolean;
  owner_id: string;
  expert_id: string | null;
  title: string | null;
  category_id: string | null;
  tags: string[];
  language: string;
  views: number;
  accepted_answer_id: string | null;
  answer_count: number;
  question: string;
  answer: string | null;
  visibility: string;
  publication: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

type Tab =
  | 'latest'
  | 'unanswered'
  | 'popular'
  | 'mine';

const draftKey =
  'vianoor:qna23-draft';

function date(
  locale: string,
  value: string,
) {
  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        dateStyle:
          'medium',

        timeStyle:
          'short',
      },
    ).format(
      new Date(
        value,
      ),
    );
  } catch {
    return value;
  }
}

export function QnaExperience({
  locale,
}: {
  locale: string;
}) {
  const t =
    qna23Copy[
      locale
    ]!;

  const [
    taxonomy,
    setTaxonomy,
  ] =
    useState<
      Taxon[]
    >([]);

  const [
    languages,
    setLanguages,
  ] =
    useState<
      Language[]
    >([]);

  const [
    tab,
    setTab,
  ] =
    useState<Tab>(
      'latest',
    );

  const [
    query,
    setQuery,
  ] =
    useState('');

  const [
    topic,
    setTopic,
  ] =
    useState('');

  const [
    feed,
    setFeed,
  ] =
    useState<
      PublicQuestion[]
    >([]);

  const [
    next,
    setNext,
  ] =
    useState<
      number | null
    >(null);

  const [
    mine,
    setMine,
  ] =
    useState<
      Mine[]
    >([]);

  const [
    authenticated,
    setAuthenticated,
  ] =
    useState(
      false,
    );

  const [
    selectedId,
    setSelectedId,
  ] =
    useState('');

  const [
    detail,
    setDetail,
  ] =
    useState<
      Detail | null
    >(null);

  const [
    translated,
    setTranslated,
  ] =
    useState(
      false,
    );

  const [
    createOpen,
    setCreateOpen,
  ] =
    useState(
      false,
    );

  const [
    draft,
    setDraft,
  ] =
    useState({
      title:
        '',

      body:
        '',

      category:
        '',

      tags:
        '',

      language:
        locale,
    });

  const [
    answer,
    setAnswer,
  ] =
    useState('');

  const [
    questionComment,
    setQuestionComment,
  ] =
    useState('');

  const [
    answerComments,
    setAnswerComments,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    notice,
    setNotice,
  ] =
    useState('');

  const [
    error,
    setError,
  ] =
    useState('');

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const categories =
    useMemo(
      () =>
        taxonomy.filter(
          (
            item,
          ) =>
            item.active &&
            item.kind ===
              'category',
        ),
      [
        taxonomy,
      ],
    );

  const mineSelected =
    useMemo(
      () =>
        mine.find(
          (
            item,
          ) =>
            item.id ===
            selectedId,
        ) ??
        null,
      [
        mine,
        selectedId,
      ],
    );

  async function loadMine() {
    try {
      const rows =
        await userApi<
          Mine[]
        >(
          'questions',
        );

      setMine(
        rows,
      );

      setAuthenticated(
        true,
      );

      return rows;
    } catch {
      setMine(
        [],
      );

      setAuthenticated(
        false,
      );

      return [];
    }
  }

  async function loadFeed(
    offset = 0,
    append = false,
  ) {
    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      const params =
        new URLSearchParams({
          q:
            query,

          filter:
            tab ===
            'mine'
              ? 'latest'
              : tab,

          offset:
            String(
              offset,
            ),

          limit:
            '20',

          ...(
            topic
              ? {
                  topic,
                }
              : {}
          ),
        });

      const result =
        await userApi<
          Feed
        >(
          'questions/public?' +
            params.toString(),
        );

      setFeed(
        (
          current,
        ) =>
          append
            ? [
                ...current,
                ...result.items,
              ]
            : result.items,
      );

      setNext(
        result.next_offset,
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

  async function openQuestion(
    id: string,
  ) {
    setBusy(
      true,
    );

    setError(
      '',
    );

    setTranslated(
      false,
    );

    try {
      const result =
        await userApi<
          Detail
        >(
          'questions/public/' +
            id +
            '?' +
            new URLSearchParams({
              language:
                locale,
            }),
        );

      setSelectedId(
        id,
      );

      setDetail(
        result,
      );

      window.history.replaceState(
        null,
        '',
        `${usersBase}/${locale}/questions?id=${encodeURIComponent(
          id,
        )}`,
      );

      await loadMine();
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

  function closeQuestion() {
    setSelectedId(
      '',
    );

    setDetail(
      null,
    );

    setTranslated(
      false,
    );

    window.history.replaceState(
      null,
      '',
      `${usersBase}/${locale}/questions`,
    );
  }

  useEffect(
    () => {
      const params =
        new URLSearchParams(
          window.location.search,
        );

      const id =
        params.get(
          'id',
        );

      if (
        params.get(
          'create',
        ) ===
          '1'
      )
        setCreateOpen(
          true,
        );

      const saved =
        params.get(
          'resume',
        ) ===
          '1'
          ? window.localStorage.getItem(
              draftKey,
            )
          : null;

      if (
        saved
      ) {
        try {
          const value =
            JSON.parse(
              saved,
            );

          setDraft(
            value,
          );

          setCreateOpen(
            true,
          );
        } catch {
          window.localStorage.removeItem(
            draftKey,
          );
        }
      }

      void Promise.all([
        userApi<
          Taxon[]
        >(
          'taxonomy',
        ),

        userApi<
          Language[]
        >(
          'languages',
        ),

        loadMine(),
      ])
        .then(
          ([
            taxons,
            languageRows,
          ]) => {
            setTaxonomy(
              taxons,
            );

            setLanguages(
              languageRows,
            );

            const fallback =
              languageRows.find(
                (
                  item,
                ) =>
                  item.code ===
                  locale,
              )?.code ??
              languageRows[0]
                ?.code ??
              locale;

            setDraft(
              (
                current,
              ) => ({
                ...current,

                language:
                  current.language ||
                  fallback,
              }),
            );
          },
        )
        .catch(
          () =>
            setError(
              t.error,
            ),
        );

      void loadFeed();

      if (
        id
      )
        void openQuestion(
          id,
        );
    },
    [
      locale,
    ],
  );

  useEffect(
    () => {
      if (
        tab ===
        'mine'
      ) {
        void loadMine();
        return;
      }

      void loadFeed();
    },
    [
      tab,
      topic,
    ],
  );

  function signIn(
    returnPath:
      string,
  ) {
    window.location.assign(
      `${usersBase}/${locale}/auth/login?return=${encodeURIComponent(
        returnPath,
      )}`,
    );
  }

  async function createQuestion() {
    setBusy(
      true,
    );

    setError(
      '',
    );

    setNotice(
      '',
    );

    const payload = {
      request_key:
        crypto.randomUUID(),

      question:
        draft.body,

      title:
        draft.title,

      category_id:
        draft.category ||
        undefined,

      tags:
        draft.tags
          .split(
            ',',
          )
          .map(
            (
              item,
            ) =>
              item.trim(),
          )
          .filter(
            Boolean,
          )
          .slice(
            0,
            8,
          ),

      language:
        draft.language,

      visibility:
        'PUBLIC',
    };

    try {
      await userApi(
        'questions',
        'POST',
        payload,
      );

      window.localStorage.removeItem(
        draftKey,
      );

      setCreateOpen(
        false,
      );

      setDraft({
        title:
          '',

        body:
          '',

        category:
          '',

        tags:
          '',

        language:
          locale,
      });

      setNotice(
        t.pendingReview,
      );

      setTab(
        'mine',
      );

      await loadMine();
    } catch (
      exception
    ) {
      const code =
        exception instanceof
        Error
          ? exception.message
          : '';

      if (
        [
          'UNAUTHORIZED',
          'INVALID_CREDENTIALS',
        ].includes(
          code,
        )
      ) {
        try {
          window.localStorage.setItem(
            draftKey,
            JSON.stringify(
              draft,
            ),
          );
        } catch {
          /* optional */
        }

        signIn(
          'questions?resume=1&create=1',
        );

        return;
      }

      setError(
        t.error,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  async function postAnswer() {
    if (
      !detail ||
      !answer.trim()
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      await userApi(
        `questions/${detail.question.id}/answers`,
        'POST',
        {
          body:
            answer,

          public_body:
            answer,
        },
      );

      setAnswer(
        '',
      );

      await openQuestion(
        detail.question.id,
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

  async function acceptAnswer(
    answerId: string,
  ) {
    if (
      !detail
    )
      return;

    setBusy(
      true,
    );

    try {
      await userApi(
        `questions/${detail.question.id}/answers/${answerId}/accept`,
        'POST',
        {},
      );

      await openQuestion(
        detail.question.id,
      );

      await loadMine();
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

  async function postComment(
    answerId:
      | string
      | null,
  ) {
    if (
      !detail
    )
      return;

    const body =
      answerId
        ? answerComments[
            answerId
          ] ??
          ''
        : questionComment;

    if (
      !body.trim()
    )
      return;

    setBusy(
      true,
    );

    setError(
      '',
    );

    try {
      await userApi(
        `questions/${detail.question.id}/comments`,
        'POST',
        {
          body,

          ...(
            answerId
              ? {
                  answer_id:
                    answerId,
                }
              : {}
          ),
        },
      );

      if (
        answerId
      )
        setAnswerComments(
          (
            current,
          ) => ({
            ...current,

            [answerId]:
              '',
          }),
        );
      else
        setQuestionComment(
          '',
        );

      await openQuestion(
        detail.question.id,
      );
    } catch (
      exception
    ) {
      const code =
        exception instanceof
        Error
          ? exception.message
          : '';

      if (
        code ===
        'UNAUTHORIZED'
      ) {
        signIn(
          `questions?id=${detail.question.id}`,
        );

        return;
      }

      setError(
        t.error,
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  async function followUp() {
    if (
      !detail
    )
      return;

    setBusy(
      true,
    );

    try {
      const conversation =
        await userApi<{
          id: string;
        }>(
          `questions/${detail.question.id}/conversation`,
          'POST',
          {},
        );

      window.location.assign(
        `${usersBase}/${locale}/account/messages?conversation=${encodeURIComponent(
          conversation.id,
        )}`,
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

  const accepted =
    detail?.answers.find(
      (
        item,
      ) =>
        item.accepted,
    ) ??
    null;

  const others =
    detail?.answers.filter(
      (
        item,
      ) =>
        !item.accepted,
    ) ??
    [];

  const original =
    detail?.question;

  const visibleTitle =
    translated &&
    detail?.translation
      ? detail.translation
          .title
      : original?.title;

  const visibleQuestion =
    translated &&
    detail?.translation
      ? detail.translation
          .question
      : original?.body;

  const acceptedText =
    translated &&
    detail?.translation
      ?.accepted_answer
      ? detail.translation
          .accepted_answer
      : accepted?.body;

  if (
    detail &&
    original
  )
    return (
      <main
        id="main"
        tabIndex={-1}
        className="qna23"
      >
        <section className="qna23-wrap qna23-detail">
          <button
            type="button"
            className="qna23-back"
            onClick={
              closeQuestion
            }
          >
            <Icon
              name="arrow"
              className="direction-icon qna23-back-icon"
            />

            {t.back}
          </button>

          {error && (
            <p
              className="qna23-error"
              role="alert"
            >
              {error}
            </p>
          )}

          <article className="qna23-question">
            <div className="qna23-original-bar">
              <span>
                <Icon name="globe" />

                {t.originalLanguage}:{' '}
                <bdi>
                  {original.language}
                </bdi>
              </span>

              <div>
                <button
                  type="button"
                  className={
                    !translated
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setTranslated(
                      false,
                    )
                  }
                >
                  {t.original}
                </button>

                <button
                  type="button"
                  disabled={
                    !detail.translation
                  }
                  className={
                    translated
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setTranslated(
                      true,
                    )
                  }
                >
                  {t.translated}
                </button>
              </div>
            </div>

            <h1>
              {visibleTitle}
            </h1>

            <p className="qna23-question-body">
              {visibleQuestion}
            </p>

            <div className="qna23-meta">
              <span>
                <Icon name="clock" />
                {date(
                  locale,
                  original.created_at,
                )}
              </span>

              <span>
                <Icon name="eye" />
                {original.views.toLocaleString(
                  locale,
                )}{' '}
                {t.views}
              </span>

              <span>
                <Icon name="user" />
                {original.author ??
                  t.anonymous}
              </span>
            </div>

            <div className="qna23-tags">
              {original.tags.length
                ? original.tags.map(
                    (
                      tag,
                    ) => (
                      <span
                        key={
                          tag
                        }
                      >
                        #{tag}
                      </span>
                    ),
                  )
                : (
                    <span>
                      {t.tagsEmpty}
                    </span>
                  )}
            </div>

            <p className="qna23-translation-notice">
              <Icon name="globe" />
              {detail.translation
                ? t.translationNotice
                : t.translationUnavailable}
            </p>

            <section className="qna23-comments">
              {original.comments.map(
                (
                  comment,
                ) => (
                  <p
                    key={
                      comment.id
                    }
                  >
                    <bdi>
                      {comment.author_code}
                    </bdi>

                    <span>
                      {comment.body}
                    </span>
                  </p>
                ),
              )}

              {authenticated ? (
                <form
                  onSubmit={(
                    event,
                  ) => {
                    event.preventDefault();

                    void postComment(
                      null,
                    );
                  }}
                >
                  <input
                    value={
                      questionComment
                    }
                    maxLength={
                      3000
                    }
                    placeholder={
                      t.commentPlaceholder
                    }
                    onChange={(
                      event,
                    ) =>
                      setQuestionComment(
                        event
                          .target
                          .value,
                      )
                    }
                  />

                  <button
                    disabled={
                      busy ||
                      !questionComment.trim()
                    }
                  >
                    {t.sendComment}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    signIn(
                      `questions?id=${original.id}`,
                    )
                  }
                >
                  {t.signInComment}
                </button>
              )}

              <small>
                {t.publicComment}
              </small>
            </section>
          </article>

          <div className="qna23-answer-heading">
            <h2>
              {t.answers}
            </h2>

            <p>
              {t.stackHint}
            </p>
          </div>

          {accepted && (
            <article className="qna23-answer accepted">
              <header>
                <span>
                  <Icon name="check" />
                  {t.accepted}
                </span>

                <small>
                  {accepted.author ??
                    t.expert}
                </small>
              </header>

              <div className="qna23-answer-body">
                {acceptedText}
              </div>

              <AnswerComments
                locale={
                  locale
                }
                t={
                  t
                }
                answer={
                  accepted
                }
                authenticated={
                  authenticated
                }
                busy={
                  busy
                }
                value={
                  accepted.id
                    ? answerComments[
                        accepted.id
                      ] ??
                      ''
                    : ''
                }
                setValue={(
                  value,
                ) => {
                  if (
                    accepted.id
                  )
                    setAnswerComments(
                      (
                        current,
                      ) => ({
                        ...current,

                        [accepted.id!]:
                          value,
                      }),
                    );
                }}
                submit={() => {
                  if (
                    accepted.id
                  )
                    void postComment(
                      accepted.id,
                    );
                }}
                signIn={() =>
                  signIn(
                    `questions?id=${original.id}`,
                  )
                }
              />
            </article>
          )}

          {others.length >
            0 && (
            <section className="qna23-other-answers">
              <h2>
                {t.otherAnswers}
              </h2>

              {others.map(
                (
                  item,
                ) => (
                  <article
                    className="qna23-answer"
                    key={
                      item.id ??
                      item.created_at
                    }
                  >
                    <header>
                      <small>
                        {item.author ??
                          t.expert}
                      </small>

                      {mineSelected
                        ?.is_owner &&
                        item.id && (
                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            void acceptAnswer(
                              item.id!,
                            )
                          }
                        >
                          <Icon name="check" />
                          {t.acceptAnswer}
                        </button>
                      )}
                    </header>

                    <div className="qna23-answer-body">
                      {item.body}
                    </div>

                    <AnswerComments
                      locale={
                        locale
                      }
                      t={
                        t
                      }
                      answer={
                        item
                      }
                      authenticated={
                        authenticated
                      }
                      busy={
                        busy
                      }
                      value={
                        item.id
                          ? answerComments[
                              item.id
                            ] ??
                            ''
                          : ''
                      }
                      setValue={(
                        value,
                      ) => {
                        if (
                          item.id
                        )
                          setAnswerComments(
                            (
                              current,
                            ) => ({
                              ...current,

                              [item.id!]:
                                value,
                            }),
                          );
                      }}
                      submit={() => {
                        if (
                          item.id
                        )
                          void postComment(
                            item.id,
                          );
                      }}
                      signIn={() =>
                        signIn(
                          `questions?id=${original.id}`,
                        )
                      }
                    />
                  </article>
                ),
              )}
            </section>
          )}

          {!detail.answers.length && (
            <div className="qna23-empty">
              <Icon name="comments" />
              {t.noAnswers}
            </div>
          )}

          {mineSelected
            ?.can_answer && (
            <section className="qna23-answer-form">
              <h2>
                {t.answerQuestion}
              </h2>

              <p>
                {t.answerPublicHint}
              </p>

              <textarea
                value={
                  answer
                }
                maxLength={
                  20000
                }
                placeholder={
                  t.answerBody
                }
                onChange={(
                  event,
                ) =>
                  setAnswer(
                    event
                      .target
                      .value,
                  )
                }
              />

              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  !answer.trim()
                }
                onClick={() =>
                  void postAnswer()
                }
              >
                {t.sendAnswer}
              </button>

              <small>
                {t.assignedOnly}
              </small>
            </section>
          )}

          {mineSelected &&
            mineSelected.expert_id && (
            <section className="qna23-followup">
              <div>
                <Icon name="lock" />

                <span>
                  <strong>
                    {t.followUp}
                  </strong>

                  <small>
                    {t.followUpHint}
                  </small>
                </span>
              </div>

              <button
                type="button"
                className="button"
                disabled={
                  busy
                }
                onClick={() =>
                  void followUp()
                }
              >
                {t.followUp}
              </button>
            </section>
          )}

          <section className="qna23-text-consult">
            <div>
              <Icon name="comments" />

              <span>
                <strong>
                  {t.textConsultation}
                </strong>

                <small>
                  {t.textConsultationHint}
                </small>
              </span>
            </div>

            <a
              className="button"
              href={`${usersBase}/${locale}/consultation?mode=text`}
            >
              {t.startTextConsultation}
            </a>
          </section>
        </section>
      </main>
    );

  return (
    <main
      id="main"
      tabIndex={-1}
      className="qna23"
    >
      <section className="qna23-hero">
        <div className="qna23-wrap">
          <span className="qna23-eyebrow">
            <Icon name="comments" />
            {t.eyebrow}
          </span>

          <h1>
            {t.title}
          </h1>

          <p>
            {t.intro}
          </p>

          <form
            className="qna23-search"
            onSubmit={(
              event,
            ) => {
              event.preventDefault();

              void loadFeed(
                0,
                false,
              );
            }}
          >
            <Icon name="search" />

            <input
              value={
                query
              }
              placeholder={
                t.search
              }
              aria-label={
                t.search
              }
              onChange={(
                event,
              ) =>
                setQuery(
                  event
                    .target
                    .value,
                )
              }
            />

            <button
              className="button"
              disabled={
                busy
              }
            >
              {t.searchButton}
            </button>
          </form>
        </div>
      </section>

      <section className="qna23-wrap qna23-layout">
        <aside className="qna23-sidebar">
          <h2>
            {t.topics}
          </h2>

          <button
            type="button"
            className={
              !topic
                ? 'active'
                : ''
            }
            onClick={() =>
              setTopic(
                '',
              )
            }
          >
            {t.allTopics}
          </button>

          {categories.map(
            (
              item,
            ) => (
              <button
                key={
                  item.id
                }
                type="button"
                className={
                  topic ===
                  item.id
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setTopic(
                    item.id,
                  )
                }
              >
                {languageValue(
                  item.label,
                  locale,
                )}
              </button>
            ),
          )}

          <div className="qna23-private-cta">
            <Icon name="lock" />

            <strong>
              {t.textConsultation}
            </strong>

            <p>
              {t.textConsultationHint}
            </p>

            <a
              href={`${usersBase}/${locale}/consultation?mode=text`}
            >
              {t.startTextConsultation}
            </a>
          </div>
        </aside>

        <div className="qna23-feed">
          <div className="qna23-tabs">
            {(
              [
                [
                  'latest',
                  t.latest,
                ],

                [
                  'unanswered',
                  t.unanswered,
                ],

                [
                  'popular',
                  t.popular,
                ],

                [
                  'mine',
                  t.mine,
                ],
              ] as const
            ).map(
              ([
                value,
                label,
              ]) => (
                <button
                  key={
                    value
                  }
                  type="button"
                  className={
                    tab ===
                    value
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setTab(
                      value,
                    )
                  }
                >
                  {label}
                </button>
              ),
            )}

            <button
              type="button"
              className="qna23-ask"
              onClick={() =>
                setCreateOpen(
                  true,
                )
              }
            >
              <Icon name="comments" />
              {t.ask}
            </button>
          </div>

          {notice && (
            <p
              className="qna23-notice"
              role="status"
            >
              {notice}
            </p>
          )}

          {error && (
            <p
              className="qna23-error"
              role="alert"
            >
              {error}
            </p>
          )}

          {tab ===
          'mine' ? (
            !authenticated ? (
              <div className="qna23-empty">
                <Icon name="user" />

                <button
                  type="button"
                  onClick={() =>
                    signIn(
                      'questions',
                    )
                  }
                >
                  {t.login}
                </button>
              </div>
            ) : !mine.length ? (
              <div className="qna23-empty">
                {t.myEmpty}
              </div>
            ) : (
              <div className="qna23-list">
                {mine.map(
                  (
                    item,
                  ) => (
                    <article
                      key={
                        item.id
                      }
                      className="qna23-card"
                    >
                      <div className="qna23-card-stats">
                        <span>
                          {item.answer_count.toLocaleString(
                            locale,
                          )}
                          <small>
                            {t.answers}
                          </small>
                        </span>

                        <span>
                          {item.views.toLocaleString(
                            locale,
                          )}
                          <small>
                            {t.views}
                          </small>
                        </span>
                      </div>

                      <div>
                        <h2>
                          {item.title ??
                            item.question.slice(
                              0,
                              140,
                            )}
                        </h2>

                        <p>
                          {item.question.slice(
                            0,
                            280,
                          )}
                        </p>

                        <div className="qna23-tags">
                          {item.tags.map(
                            (
                              tag,
                            ) => (
                              <span
                                key={
                                  tag
                                }
                              >
                                #{tag}
                              </span>
                            ),
                          )}
                        </div>

                        <footer>
                          <span>
                            {t.publicStatus}:{' '}
                            {item.publication}
                          </span>

                          <span>
                            {item.expert_id
                              ? t.assigned
                              : t.notAssigned}
                          </span>

                          {item.publication ===
                            'PUBLISHED' && (
                            <button
                              type="button"
                              onClick={() =>
                                void openQuestion(
                                  item.id,
                                )
                              }
                            >
                              {t.open}
                            </button>
                          )}
                        </footer>
                      </div>
                    </article>
                  ),
                )}
              </div>
            )
          ) : busy &&
            !feed.length ? (
            <div className="qna23-empty">
              {t.loading}
            </div>
          ) : !feed.length ? (
            <div className="qna23-empty">
              <Icon name="search" />
              {t.noQuestions}
            </div>
          ) : (
            <>
              <div className="qna23-list">
                {feed.map(
                  (
                    item,
                  ) => (
                    <article
                      key={
                        item.id
                      }
                      className="qna23-card"
                    >
                      <div className="qna23-card-stats">
                        <span
                          className={
                            item.answered
                              ? 'answered'
                              : ''
                          }
                        >
                          {item.answer_count.toLocaleString(
                            locale,
                          )}

                          <small>
                            {t.answers}
                          </small>
                        </span>

                        <span>
                          {item.comment_count.toLocaleString(
                            locale,
                          )}

                          <small>
                            {t.comments}
                          </small>
                        </span>

                        <span>
                          {item.views.toLocaleString(
                            locale,
                          )}

                          <small>
                            {t.views}
                          </small>
                        </span>
                      </div>

                      <div className="qna23-card-body">
                        <button
                          type="button"
                          className="qna23-question-link"
                          onClick={() =>
                            void openQuestion(
                              item.id,
                            )
                          }
                        >
                          {item.title}
                        </button>

                        <p>
                          {item.question.slice(
                            0,
                            320,
                          )}
                        </p>

                        <div className="qna23-tags">
                          {item.tags.length
                            ? item.tags.map(
                                (
                                  tag,
                                ) => (
                                  <span
                                    key={
                                      tag
                                    }
                                  >
                                    #{tag}
                                  </span>
                                ),
                              )
                            : (
                                <span>
                                  {t.tagsEmpty}
                                </span>
                              )}
                        </div>

                        <footer>
                          <span>
                            <Icon name="globe" />
                            <bdi>
                              {item.language}
                            </bdi>
                          </span>

                          <span>
                            <Icon name="clock" />
                            {date(
                              locale,
                              item.updated_at,
                            )}
                          </span>

                          <span>
                            <Icon name="user" />
                            {item.author ??
                              t.anonymous}
                          </span>
                        </footer>
                      </div>
                    </article>
                  ),
                )}
              </div>

              {next !==
                null && (
                <button
                  type="button"
                  className="button qna23-more"
                  disabled={
                    busy
                  }
                  onClick={() =>
                    void loadFeed(
                      next,
                      true,
                    )
                  }
                >
                  {t.loadMore}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {createOpen && (
        <div className="qna23-modal">
          <button
            type="button"
            className="qna23-modal-backdrop"
            aria-label={
              t.back
            }
            onClick={() =>
              setCreateOpen(
                false,
              )
            }
          />

          <section
            role="dialog"
            aria-modal="true"
            className="qna23-modal-panel"
          >
            <header>
              <h2>
                {t.askTitle}
              </h2>

              <button
                type="button"
                onClick={() =>
                  setCreateOpen(
                    false,
                  )
                }
              >
                <Icon name="close" />
              </button>
            </header>

            <label>
              {t.questionTitle}

              <input
                value={
                  draft.title
                }
                required
                maxLength={
                  180
                }
                onChange={(
                  event,
                ) =>
                  setDraft(
                    {
                      ...draft,

                      title:
                        event
                          .target
                          .value,
                    },
                  )
                }
              />
            </label>

            <label>
              {t.questionBody}

              <textarea
                value={
                  draft.body
                }
                required
                minLength={
                  3
                }
                maxLength={
                  12000
                }
                onChange={(
                  event,
                ) =>
                  setDraft(
                    {
                      ...draft,

                      body:
                        event
                          .target
                          .value,
                    },
                  )
                }
              />
            </label>

            <label>
              {t.category}

              <select
                value={
                  draft.category
                }
                onChange={(
                  event,
                ) =>
                  setDraft(
                    {
                      ...draft,

                      category:
                        event
                          .target
                          .value,
                    },
                  )
                }
              >
                <option value="">
                  {t.allTopics}
                </option>

                {categories.map(
                  (
                    item,
                  ) => (
                    <option
                      key={
                        item.id
                      }
                      value={
                        item.id
                      }
                    >
                      {languageValue(
                        item.label,
                        locale,
                      )}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label>
              {t.tags}

              <input
                value={
                  draft.tags
                }
                maxLength={
                  300
                }
                placeholder={
                  t.tagsHint
                }
                onChange={(
                  event,
                ) =>
                  setDraft(
                    {
                      ...draft,

                      tags:
                        event
                          .target
                          .value,
                    },
                  )
                }
              />
            </label>

            <label>
              {t.language}

              <select
                value={
                  draft.language
                }
                onChange={(
                  event,
                ) =>
                  setDraft(
                    {
                      ...draft,

                      language:
                        event
                          .target
                          .value,
                    },
                  )
                }
              >
                {languages.map(
                  (
                    item,
                  ) => (
                    <option
                      key={
                        item.code
                      }
                      value={
                        item.code
                      }
                    >
                      {item.native_name ??
                        item.name_en}
                    </option>
                  ),
                )}
              </select>
            </label>

            <p className="qna23-public-hint">
              <Icon name="globe" />
              {t.publicQuestion}
            </p>

            {!authenticated && (
              <p className="qna23-public-hint">
                <Icon name="shield" />
                {t.draftSaved}
              </p>
            )}

            <button
              type="button"
              className="button"
              disabled={
                busy ||
                !draft.title.trim() ||
                !draft.body.trim()
              }
              onClick={() =>
                void createQuestion()
              }
            >
              {authenticated
                ? t.submit
                : t.signInAsk}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function AnswerComments({
  t,
  answer,
  authenticated,
  busy,
  value,
  setValue,
  submit,
  signIn,
}: {
  locale: string;

  t: typeof qna23Copy.en;

  answer: PublicAnswer;

  authenticated: boolean;

  busy: boolean;

  value: string;

  setValue:
    (
      value: string,
    ) => void;

  submit:
    () => void;

  signIn:
    () => void;
}) {
  return (
    <section className="qna23-comments">
      {answer.comments.map(
        (
          comment,
        ) => (
          <p
            key={
              comment.id
            }
          >
            <bdi>
              {comment.author_code}
            </bdi>

            <span>
              {comment.body}
            </span>
          </p>
        ),
      )}

      {answer.id &&
        (
          authenticated ? (
            <form
              onSubmit={(
                event,
              ) => {
                event.preventDefault();

                submit();
              }}
            >
              <input
                value={
                  value
                }
                maxLength={
                  3000
                }
                placeholder={
                  t.commentPlaceholder
                }
                onChange={(
                  event,
                ) =>
                  setValue(
                    event
                      .target
                      .value,
                  )
                }
              />

              <button
                disabled={
                  busy ||
                  !value.trim()
                }
              >
                {t.sendComment}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={
                signIn
              }
            >
              {t.signInComment}
            </button>
          )
        )}
    </section>
  );
}
