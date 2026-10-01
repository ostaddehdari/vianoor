'use client';

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  Icon,
} from './icons';

import {
  dashboard22TableCopy,
} from './dashboard22-table-copy';

export type DashboardColumn<T> = {
  key: string;

  label: string;

  render: (
    row: T,
  ) => ReactNode;

  searchValue?: (
    row: T,
  ) => string;

  sortValue?: (
    row: T,
  ) =>
    | string
    | number;

  sortable?: boolean | undefined;

  hideable?: boolean | undefined;

  defaultHidden?: boolean | undefined;
};

export function DashboardDataTable<
  T extends object,
>({
  locale,
  rows,
  columns,
  getRowId,
  renderActions,
  primaryAction,
  filters,
  emptyText,
  pageSize = 10,
  bulkActions,
}: {
  locale: string;

  rows: T[];

  columns:
    DashboardColumn<T>[];

  getRowId: (
    row: T,
    index: number,
  ) => string;

  renderActions?: (
    row: T,
  ) => ReactNode;

  primaryAction?: ReactNode;

  filters?: ReactNode;

  emptyText?: string | undefined;

  pageSize?: number | undefined;

  bulkActions?: (
    rows: T[],
    clear: () => void,
  ) => ReactNode;
}) {
  const t =
    dashboard22TableCopy[
      locale
    ]!;

  const [
    query,
    setQuery,
  ] =
    useState('');

  const [
    sortKey,
    setSortKey,
  ] =
    useState('');

  const [
    direction,
    setDirection,
  ] =
    useState<
      'asc' |
      'desc'
    >(
      'asc',
    );

  const [
    page,
    setPage,
  ] =
    useState(0);

  const [
    selected,
    setSelected,
  ] =
    useState<
      Set<string>
    >(
      new Set(),
    );

  const signature =
    columns
      .map(
        (
          column,
        ) =>
          `${column.key}:${
            column.defaultHidden
              ? '0'
              : '1'
          }`,
      )
      .join(
        '|',
      );

  const [
    visible,
    setVisible,
  ] =
    useState<
      Set<string>
    >(
      () =>
        new Set(
          columns
            .filter(
              (
                column,
              ) =>
                !column.defaultHidden,
            )
            .map(
              (
                column,
              ) =>
                column.key,
            ),
        ),
    );

  useEffect(
    () => {
      setVisible(
        new Set(
          columns
            .filter(
              (
                column,
              ) =>
                !column.defaultHidden,
            )
            .map(
              (
                column,
              ) =>
                column.key,
            ),
        ),
      );
    },
    [
      signature,
    ],
  );

  useEffect(
    () => {
      setPage(
        0,
      );
    },
    [
      query,
      sortKey,
      direction,
      rows.length,
    ],
  );

  const normalized =
    query
      .trim()
      .toLocaleLowerCase(
        locale,
      );

  const filtered =
    useMemo(
      () => {
        if (
          !normalized
        )
          return rows;

        return rows.filter(
          (
            row,
          ) =>
            columns.some(
              (
                column,
              ) => {
                const value =
                  column.searchValue
                    ? column.searchValue(
                        row,
                      )
                    : column.sortValue
                      ? String(
                          column.sortValue(
                            row,
                          ),
                        )
                      : '';

                return value
                  .toLocaleLowerCase(
                    locale,
                  )
                  .includes(
                    normalized,
                  );
              },
            ),
        );
      },
      [
        rows,
        columns,
        normalized,
        locale,
      ],
    );

  const sorted =
    useMemo(
      () => {
        if (
          !sortKey
        )
          return filtered;

        const column =
          columns.find(
            (
              item,
            ) =>
              item.key ===
              sortKey,
          );

        if (
          !column
        )
          return filtered;

        return [
          ...filtered,
        ].sort(
          (
            first,
            second,
          ) => {
            const a =
              column.sortValue
                ? column.sortValue(
                    first,
                  )
                : column.searchValue
                  ? column.searchValue(
                      first,
                    )
                  : '';

            const b =
              column.sortValue
                ? column.sortValue(
                    second,
                  )
                : column.searchValue
                  ? column.searchValue(
                      second,
                    )
                  : '';

            const result =
              typeof a ===
                'number' &&
              typeof b ===
                'number'
                ? a - b
                : String(
                    a,
                  ).localeCompare(
                    String(
                      b,
                    ),
                    locale,
                    {
                      numeric:
                        true,

                      sensitivity:
                        'base',
                    },
                  );

            return direction ===
              'asc'
              ? result
              : -result;
          },
        );
      },
      [
        filtered,
        sortKey,
        columns,
        direction,
        locale,
      ],
    );

  const safePageSize =
    Math.max(
      1,
      pageSize,
    );

  const pages =
    Math.max(
      1,
      Math.ceil(
        sorted.length /
          safePageSize,
      ),
    );

  const safePage =
    Math.min(
      page,
      pages - 1,
    );

  const pageRows =
    sorted.slice(
      safePage *
        safePageSize,
      (
        safePage +
        1
      ) *
        safePageSize,
    );

  const activeColumns =
    columns.filter(
      (
        column,
      ) =>
        visible.has(
          column.key,
        ),
    );

  const selectedRows =
    rows.filter(
      (
        row,
        index,
      ) =>
        selected.has(
          getRowId(
            row,
            index,
          ),
        ),
    );

  const selectPage =
    (
      checked: boolean,
    ) => {
      setSelected(
        (
          current,
        ) => {
          const next =
            new Set(
              current,
            );

          pageRows.forEach(
            (
              row,
              index,
            ) => {
              const id =
                getRowId(
                  row,
                  index,
                );

              if (
                checked
              )
                next.add(
                  id,
                );
              else
                next.delete(
                  id,
                );
            },
          );

          return next;
        },
      );
    };

  const clearSelection =
    () =>
      setSelected(
        new Set(),
      );

  return (
    <div className="dash22-table">
      <div className="dash22-table-toolbar">
        <label className="dash22-table-search">
          <Icon name="search" />

          <input
            value={
              query
            }
            aria-label={
              t.searchLabel
            }
            placeholder={
              t.search
            }
            onChange={(
              event,
            ) =>
              setQuery(
                event.target
                  .value,
              )
            }
          />
        </label>

        {filters && (
          <div className="dash22-table-filters">
            {filters}
          </div>
        )}

        <details className="dash22-column-menu">
          <summary>
            <Icon name="filter" />
            {t.columns}
          </summary>

          <div>
            {columns
              .filter(
                (
                  column,
                ) =>
                  column.hideable !==
                  false,
              )
              .map(
                (
                  column,
                ) => (
                  <label
                    key={
                      column.key
                    }
                  >
                    <input
                      type="checkbox"
                      checked={
                        visible.has(
                          column.key,
                        )
                      }
                      onChange={(
                        event,
                      ) =>
                        setVisible(
                          (
                            current,
                          ) => {
                            const next =
                              new Set(
                                current,
                              );

                            if (
                              event
                                .target
                                .checked
                            )
                              next.add(
                                column.key,
                              );
                            else
                              next.delete(
                                column.key,
                              );

                            return next;
                          },
                        )
                      }
                    />

                    {column.label}
                  </label>
                ),
              )}
          </div>
        </details>

        {primaryAction && (
          <div className="dash22-table-primary">
            {primaryAction}
          </div>
        )}
      </div>

      {bulkActions &&
        selectedRows.length >
          0 && (
          <div className="dash22-bulk-bar">
            <span>
              {selectedRows.length.toLocaleString(
                locale,
              )}{' '}
              {t.selected}
            </span>

            {bulkActions(
              selectedRows,
              clearSelection,
            )}
          </div>
        )}

      {!sorted.length ? (
        <div className="dash22-table-empty">
          <Icon name="search" />

          <p>
            {emptyText ??
              t.empty}
          </p>

          {query && (
            <button
              type="button"
              onClick={() =>
                setQuery(
                  '',
                )
              }
            >
              {t.clear}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="dash22-table-scroll">
            <table>
              <thead>
                <tr>
                  {bulkActions && (
                    <th className="dash22-select-column">
                      <input
                        type="checkbox"
                        aria-label={
                          t.selectAll
                        }
                        checked={
                          pageRows.length >
                            0 &&
                          pageRows.every(
                            (
                              row,
                              index,
                            ) =>
                              selected.has(
                                getRowId(
                                  row,
                                  index,
                                ),
                              ),
                          )
                        }
                        onChange={(
                          event,
                        ) =>
                          selectPage(
                            event
                              .target
                              .checked,
                          )
                        }
                      />
                    </th>
                  )}

                  {activeColumns.map(
                    (
                      column,
                    ) => (
                      <th
                        key={
                          column.key
                        }
                      >
                        {column.sortable ===
                        false ? (
                          column.label
                        ) : (
                          <button
                            type="button"
                            className="dash22-sort-button"
                            onClick={() => {
                              if (
                                sortKey ===
                                column.key
                              )
                                setDirection(
                                  (
                                    current,
                                  ) =>
                                    current ===
                                    'asc'
                                      ? 'desc'
                                      : 'asc',
                                );
                              else {
                                setSortKey(
                                  column.key,
                                );

                                setDirection(
                                  'asc',
                                );
                              }
                            }}
                          >
                            {column.label}

                            {sortKey ===
                              column.key && (
                              <Icon
                                name={
                                  direction ===
                                  'asc'
                                    ? 'up'
                                    : 'down'
                                }
                              />
                            )}
                          </button>
                        )}
                      </th>
                    ),
                  )}

                  {renderActions && (
                    <th>
                      {t.actions}
                    </th>
                  )}
                </tr>
              </thead>

              <tbody>
                {pageRows.map(
                  (
                    row,
                    index,
                  ) => {
                    const id =
                      getRowId(
                        row,
                        index,
                      );

                    return (
                      <tr
                        key={
                          id
                        }
                      >
                        {bulkActions && (
                          <td className="dash22-select-column">
                            <input
                              type="checkbox"
                              checked={
                                selected.has(
                                  id,
                                )
                              }
                              onChange={(
                                event,
                              ) =>
                                setSelected(
                                  (
                                    current,
                                  ) => {
                                    const next =
                                      new Set(
                                        current,
                                      );

                                    if (
                                      event
                                        .target
                                        .checked
                                    )
                                      next.add(
                                        id,
                                      );
                                    else
                                      next.delete(
                                        id,
                                      );

                                    return next;
                                  },
                                )
                              }
                            />
                          </td>
                        )}

                        {activeColumns.map(
                          (
                            column,
                          ) => (
                            <td
                              key={
                                column.key
                              }
                            >
                              {column.render(
                                row,
                              )}
                            </td>
                          ),
                        )}

                        {renderActions && (
                          <td>
                            <div className="dash22-row-actions">
                              {renderActions(
                                row,
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>

          <div className="dash22-mobile-records">
            {pageRows.map(
              (
                row,
                index,
              ) => {
                const id =
                  getRowId(
                    row,
                    index,
                  );

                return (
                  <article
                    key={
                      id
                    }
                    className="dash22-mobile-record"
                  >
                    {activeColumns.map(
                      (
                        column,
                      ) => (
                        <div
                          key={
                            column.key
                          }
                        >
                          <span>
                            {column.label}
                          </span>

                          <strong>
                            {column.render(
                              row,
                            )}
                          </strong>
                        </div>
                      ),
                    )}

                    {renderActions && (
                      <footer>
                        {renderActions(
                          row,
                        )}
                      </footer>
                    )}
                  </article>
                );
              },
            )}
          </div>

          <footer className="dash22-table-footer">
            <span>
              {t.showing}{' '}
              {sorted.length.toLocaleString(
                locale,
              )}{' '}
              {t.records}
            </span>

            <div>
              <button
                type="button"
                disabled={
                  safePage ===
                  0
                }
                onClick={() =>
                  setPage(
                    Math.max(
                      0,
                      safePage -
                        1,
                    ),
                  )
                }
              >
                <Icon name="chevron" />
                {t.previous}
              </button>

              <span>
                {t.page}{' '}
                {(
                  safePage +
                  1
                ).toLocaleString(
                  locale,
                )}{' '}
                {t.of}{' '}
                {pages.toLocaleString(
                  locale,
                )}
              </span>

              <button
                type="button"
                disabled={
                  safePage >=
                  pages - 1
                }
                onClick={() =>
                  setPage(
                    Math.min(
                      pages -
                        1,
                      safePage +
                        1,
                    ),
                  )
                }
              >
                {t.next}
                <Icon name="next" />
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
