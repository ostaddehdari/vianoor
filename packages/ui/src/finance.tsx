'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { financeCopy } from './finance-copy';
import { userApi, usersBase } from './users-client';
import { DashboardDrawer } from './dashboard22-drawer';
import { DashboardDataTable } from './dashboard22-table';
import { dashboard22TableCopy } from './dashboard22-table-copy';
import { Icon } from './icons';
type Row = Record<string, unknown>;
type Copy = Record<string, string>;
const str = (value: unknown) =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
const fields = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
};
const split = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
export function Money({ amount, decimals = 2 }: { amount: unknown; decimals?: number }) {
  const value = str(amount);
  if (!/^\d+$/.test(value)) return <bdi>{value}</bdi>;
  const s = value.padStart(decimals + 1, '0');
  return <bdi>{decimals ? s.slice(0, -decimals) + '.' + s.slice(-decimals) : s}</bdi>;
}
function Input({
  name,
  t,
  type = 'text',
  value,
  required = true,
}: {
  name: string;
  t: Copy;
  type?: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {t[name] ?? name}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
      />
    </label>
  );
}
function Table({
  locale,
  rows,
  columns,
  t,
  actions,
}: {
  locale: string;
  rows: Row[];
  columns: string[];
  t: Copy;
  actions?: ((row: Row) => React.ReactNode) | undefined;
}) {
  return (
    <DashboardDataTable
      locale={locale}
      rows={rows}
      getRowId={(row, index) =>
        str(
          row.id ??
          row.reference ??
          index
        )
      }
      columns={columns.map(
        (column) => ({
          key: column,

          label:
            t[column] ??
            column,

          render: (row: Row) => (
            <bdi>
              {[
                'amount',
                'balance',
                'debit',
                'credit',
                'gross',
                'commission',
                'tax',
                'refunds',
                'net_revenue',
                'fee',
              ].includes(
                column,
              ) &&
              row.currency ? (
                <Money
                  amount={
                    row[column]
                  }
                  decimals={
                    [
                      'IRR',
                      'IRT',
                    ].includes(
                      str(
                        row.currency,
                      ),
                    )
                      ? 0
                      : str(
                            row.currency,
                          ) ===
                          'BTC'
                        ? 8
                        : str(
                              row.currency,
                            ) ===
                            'ETH'
                          ? 18
                          : [
                                'USDT',
                                'USDC',
                              ].includes(
                                str(
                                  row.currency,
                                ),
                              )
                            ? 6
                            : 2
                  }
                />
              ) : (
                t[
                  str(
                    row[column],
                  )
                ] ??
                str(
                  row[column],
                )
              )}
            </bdi>
          ),

          searchValue:
            (row: Row) =>
              str(
                row[column],
              ),

          sortValue:
            (row: Row) => {
              const value =
                row[column];

              return typeof value ===
                'number'
                ? value
                : str(
                    value,
                  );
            },
        }),
      )}
      {...(
        actions
          ? {
              renderActions:
                actions,
            }
          : {}
      )}
    />
  );
}

export function FinanceWorkspace({
  locale,
  admin = false,
}: {
  locale: string;
  admin?: boolean;
  expert?: boolean;
}) {
  const t = financeCopy[locale]! as Copy,
    [tab, setTab] = useState(admin ? 'gateways' : 'wallet'),
    [rows, setRows] = useState<Row[]>([]),
    [extra, setExtra] = useState<Row>({}),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [provider, setProvider] = useState('stripe'),
    [method, setMethod] = useState('BANK'),
    [details, setDetails] = useState<Row | null>(null),
    [activeDispute, setActiveDispute] = useState(''),
    [messages, setMessages] = useState<Row[]>([]),
    [period, setPeriod] = useState('month');
  const [payment, setPayment] = useState<Row | null>(null),
    [booking, setBooking] = useState(''),
    [quote, setQuote] = useState<Row | null>(null),
    [paymentDrawerOpen, setPaymentDrawerOpen] = useState(false),
    [payoutDrawerOpen, setPayoutDrawerOpen] = useState(false);
  const request = useRef({ fingerprint: '', key: '' });
  const path = (part: string) => `${usersBase}/${locale}/${part}`;
  const act = async (fn: () => Promise<unknown>, reload = true) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(t.success!);
      if (reload) await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(t[code] ?? t.error!);
    } finally {
      setBusy(false);
    }
  };
  async function load() {
    if (admin) {
      const endpoint = {
        gateways: 'finance/gateways',
        payments: 'finance/payments',
        ledger: 'accounting/ledger',
        refunds: 'finance/refunds',
        payouts: 'payouts/admin',
        disputes: 'disputes?admin=1',
        reports: 'finance/reports?period=' + period,
        rates: 'accounting/rates',
      }[tab];
      if (endpoint) {
        setRows(await userApi<Row[]>(endpoint));
        setExtra({});
      } else {
        const d = await userApi<Row>('finance/' + tab);
        setExtra(d);
        setRows((d.rules ?? d.issues ?? []) as Row[]);
      }
    } else if (tab === 'wallet') {
      const [balances, history, methods, currencies, payments] = await Promise.all([
        userApi<Row[]>('wallet'),
        userApi<Row[]>('wallet/history'),
        userApi<Row>('payments/methods'),
        userApi<Row[]>('accounting/currencies'),
        userApi<Row[]>('payments'),
      ]);
      setRows(history);
      setExtra({ balances, methods, currencies, payments });
    } else if (tab === 'payouts') {
      const [list, destinations, currencies] = await Promise.all([
        userApi<Row[]>('payouts/withdrawals'),
        userApi<Row[]>('payouts/destinations'),
        userApi<Row[]>('accounting/currencies'),
      ]);
      setRows(list);
      setExtra({ destinations, currencies });
    } else {
      setRows(await userApi<Row[]>('disputes'));
      setExtra({});
    }
  }
  useEffect(() => {
    setError('');
    setRows([]);
    setExtra({});
    void load().catch(() => setError(t.error!));
  }, [tab, period, locale]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setBooking(q.get('booking') ?? '');

    if (q.get('booking')) {
      setProvider('wallet');
      setPaymentDrawerOpen(true);
    }

    if (q.get('create') === 'payment')
      setPaymentDrawerOpen(true);

    if (q.get('create') === 'withdrawal')
      setPayoutDrawerOpen(true);
    const id = q.get('payment');
    if (id && /^[a-f0-9-]{36}$/.test(id))
      void userApi<Row>('payments/' + id)
        .then(setPayment)
        .catch(() => setError(t.error!));
  }, []);
  const actionButton = (label: string, route: string, body: Row = {}) => (
    <button disabled={busy} onClick={() => void act(() => userApi(route, 'POST', body))}>
      {t[label] ?? label}
    </button>
  );
  const tabs = admin
    ? [
        'gateways',
        'payments',
        'ledger',
        'refunds',
        'payouts',
        'disputes',
        'settings',
        'rates',
        'risk',
        'reconciliation',
        'reports',
      ]
    : ['wallet', 'payouts', 'disputes'];
  const currencySelect = (name = 'currency') => (
    <label>
      {t[name]}
      <select name={name} defaultValue="USD">
        {(
          (extra.currencies ?? [
            { code: 'USD' },
            { code: 'EUR' },
            { code: 'GBP' },
            { code: 'AED' },
            { code: 'IRR' },
            { code: 'USDT' },
            { code: 'USDC' },
            { code: 'BTC' },
            { code: 'ETH' },
          ]) as Row[]
        ).map((c) => (
          <option key={str(c.code)}>{str(c.code)}</option>
        ))}
      </select>
    </label>
  );
  const toMinor = (amount: string, code: string) => {
    const unit = ((extra.currencies ?? []) as Row[]).find((c) => c.code === code);
    const decimals = Number(unit?.decimals ?? 2);
    if (!/^\d+(\.\d+)?$/.test(amount)) throw Error('INVALID_AMOUNT');
    const [whole, part = ''] = amount.split('.');
    if (part.length > decimals) throw Error('INVALID_AMOUNT');
    return (
      BigInt(whole!) * 10n ** BigInt(decimals) +
      BigInt(part.padEnd(decimals, '0') || '0')
    ).toString();
  };
  return (
    <section className="user-card finance-workspace">
      <h2>{admin ? t.admin : t.title}</h2>
      <nav className="user-actions" aria-label={t.title}>
        {tabs.map((x) => (
          <button
            key={x}
            aria-pressed={tab === x}
            onClick={() => {
              setTab(x);
              setDetails(null);
              setActiveDispute('');
            }}
          >
            {t[x]}
          </button>
        ))}
        <button disabled={busy} onClick={() => void act(async () => {}, true)}>
          {t.refresh}
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {admin && tab === 'gateways' && (
        <>
          <p>{t.keysHint}</p>
          <p>{t.webhookHint}</p>
          <Table
            locale={locale}
            rows={rows}
            columns={['provider', 'mode', 'currencies', 'connection_status', 'enabled']}
            t={t}
            actions={(r) => (
              <>
                {actionButton('test', 'finance/gateways/' + r.id + '/test')}
                {actionButton(
                  r.enabled ? 'disable' : 'enable',
                  'finance/gateways/' + r.id + '/toggle',
                  { enabled: !r.enabled },
                )}
                <button
                  onClick={() => {
                    setProvider(str(r.provider));
                    setDetails({
                      webhook: window.location.origin + usersBase + '/api/payment-webhooks/' + r.id,
                    });
                  }}
                >
                  {t.webhook}
                </button>
              </>
            )}
          />
          <form
            className="scholar-form"
            key={provider}
            onSubmit={(e) => {
              const d = fields(e);
              const form = e.currentTarget;
              void act(async () => {
                const result = await userApi<Row>('finance/gateways', 'POST', {
                  provider,
                  mode: d.mode,
                  enabled: false,
                  currencies: split(d.currencies ?? 'USD'),
                  countries: split(d.countries ?? ''),
                  credentials: Object.fromEntries(
                    Object.entries(d).filter(
                      ([k]) => !['mode', 'currencies', 'countries'].includes(k),
                    ),
                  ),
                });
                form.reset();
                setDetails({ webhook: result.webhook_url });
              });
            }}
          >
            <label>
              {t.provider}
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {['stripe', 'paypal', 'nowpayments'].map((p) => (
                  <option key={p} value={p}>
                    {t[p.toUpperCase()]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.mode}
              <select name="mode">
                <option value="TEST">{t.testMode}</option>
                <option value="LIVE">{t.liveMode}</option>
              </select>
            </label>
            <Input t={t} name="currencies" value="USD,EUR" />
            <Input t={t} name="countries" required={false} />
            {(provider === 'stripe'
              ? ['secret_key', 'webhook_secret']
              : provider === 'paypal'
                ? ['client_id', 'client_secret', 'webhook_id']
                : ['api_key', 'ipn_secret', 'payout_email', 'payout_password']
            ).map((k) => (
              <Input key={k} t={t} name={k} type="password" required={false} />
            ))}
            <button className="button" disabled={busy}>
              {t.save}
            </button>
          </form>
        </>
      )}
      {admin && tab === 'settings' && (
        <>
          <form
            className="scholar-form"
            key={JSON.stringify(extra.settings)}
            onSubmit={(e) => {
              const d = fields(e);
              void act(() =>
                userApi('finance/settings', 'POST', {
                  commission_bps: Number(d.commission_bps),
                  release_hours: Number(d.release_hours),
                  max_hourly_attempts: Number(d.max_hourly_attempts),
                  max_topup_minor: d.max_topup_minor,
                  tax_bps: Number(d.tax_bps),
                }),
              );
            }}
          >
            {[
              'commission_bps',
              'tax_bps',
              'release_hours',
              'max_hourly_attempts',
              'max_topup_minor',
            ].map((k) => (
              <Input
                key={k}
                name={k}
                t={t}
                type="number"
                value={str((extra.settings as Row | undefined)?.[k] ?? '')}
              />
            ))}
            <button disabled={busy}>{t.save}</button>
          </form>
          <details>
            <summary>{t.newRule}</summary>
            <form
              className="scholar-form"
              onSubmit={(e) => {
                const d = fields(e);
                void act(() =>
                  userApi('finance/commissions', 'POST', {
                    expert_id: d.expert_id || null,
                    specialty_id: d.specialty_id || null,
                    country: d.country || null,
                    service_kind: d.service_kind || null,
                    basis_points: Number(d.commission_bps),
                    priority: Number(d.priority),
                    active: true,
                  }),
                );
              }}
            >
              {['expert_id', 'specialty_id', 'country', 'service_kind'].map((k) => (
                <Input key={k} name={k} t={t} required={false} />
              ))}
              <Input name="commission_bps" t={t} type="number" value="2000" />
              <Input name="priority" t={t} type="number" value="0" />
              <button disabled={busy}>{t.save}</button>
            </form>
          </details>
          <Table
            locale={locale}
            rows={rows}
            columns={['expert_id', 'country', 'service_kind', 'basis_points', 'priority', 'active']}
            t={t}
            actions={(r) =>
              actionButton(
                r.active ? 'disable' : 'enable',
                'finance/commissions/' + r.id + '/toggle',
                { active: !r.active },
              )
            }
          />
        </>
      )}
      {admin && tab === 'rates' && (
        <>
          <form
            className="scholar-form"
            onSubmit={(e) => {
              const d = fields(e);
              void act(() =>
                userApi('accounting/rates', 'POST', {
                  ...d,
                  valid_until: new Date(d.validUntil!).toISOString(),
                  validUntil: undefined,
                }),
              );
            }}
          >
            {currencySelect('base')}
            {currencySelect('quote')}
            <Input name="numerator" t={t} value="1" />
            <Input name="denominator" t={t} value="1" />
            <Input name="source" t={t} />
            <Input name="validUntil" t={t} type="datetime-local" />
            <button disabled={busy}>{t.save}</button>
          </form>
          <Table
            locale={locale}
            rows={rows}
            columns={['base', 'quote', 'numerator', 'denominator', 'valid_until', 'source']}
            t={t}
          />
        </>
      )}
      {admin && tab === 'payments' && (
        <Table
            locale={locale}
          rows={rows}
          columns={['id', 'provider', 'amount', 'currency', 'status', 'fulfillment', 'fee', 'risk']}
          t={t}
          actions={(r) => (
            <>
              {actionButton('review', 'payments/' + r.id + '/reconcile')}
              {(r.status === 'RISK_REVIEW' || r.risk_hold === true) &&
                actionButton('approveRisk', 'finance/payments/' + r.id + '/approve-risk')}
              {r.status === 'CREATE_UNCERTAIN' && (
                <form
                  onSubmit={(e) => {
                    const d = fields(e);
                    void act(() =>
                      userApi('finance/payments/' + r.id + '/reference', 'POST', {
                        reference: d.reference,
                      }),
                    );
                  }}
                >
                  <Input t={t} name="reference" />
                  <button disabled={busy}>{t.review}</button>
                </form>
              )}
            </>
          )}
        />
      )}
      {admin && tab === 'ledger' && (
        <>
          <button
            onClick={() =>
              void act(
                async () =>
                  setDetails({ trial_balance: await userApi('accounting/trial-balance') }),
                false,
              )
            }
          >
            {t.balance}
          </button>
          <Table
            locale={locale}
            rows={rows}
            columns={['id', 'reference', 'description', 'created_at']}
            t={t}
            actions={(r) => (
              <button onClick={() => setDetails({ lines: r.lines })}>{t.details}</button>
            )}
          />
        </>
      )}
      {admin && tab === 'refunds' && (
        <Table
            locale={locale}
          rows={rows}
          columns={['payment_id', 'target', 'reason', 'status']}
          t={t}
          actions={(r) => (
            <>
              {['REQUESTED', 'APPROVED', 'PROCESSING'].includes(str(r.status)) &&
                actionButton('approve', 'finance/refunds/' + r.id + '/approve')}
              {r.status === 'REQUESTED' &&
                actionButton('reject', 'finance/refunds/' + r.id + '/reject')}
            </>
          )}
        />
      )}
      {admin && tab === 'reports' && (
        <>
          <label>
            {t.period}
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {['day', 'month', 'year'].map((x) => (
                <option key={x} value={x}>
                  {t[x]}
                </option>
              ))}
            </select>
          </label>
          <Table
            locale={locale}
            rows={rows}
            columns={[
              'period',
              'currency',
              'provider',
              'country',
              'count',
              'gross',
              'commission',
              'tax',
              'refunds',
              'net_revenue',
            ]}
            t={t}
          />
        </>
      )}
      {admin && tab === 'risk' && (
        <>
          <h3>{t.riskSettings}</h3>
          <p>{t.riskHint}</p>
          <p>
            {t.ipinfo_configured}: {str(extra.ipinfo_configured)}
          </p>
          <form
            className="scholar-form"
            key={JSON.stringify(extra)}
            onSubmit={(e) => {
              const d = fields(e);
              void act(() =>
                userApi('finance/risk', 'POST', {
                  review_spikes: d.review_spikes === 'on',
                  ipinfo_token: d.ipinfo_token,
                }),
              );
            }}
          >
            <label>
              <input name="review_spikes" type="checkbox" defaultChecked={!!extra.review_spikes} />
              {t.review_spikes}
            </label>
            <Input t={t} name="ipinfo_token" type="password" required={false} />
            <button disabled={busy}>{t.save}</button>
          </form>
        </>
      )}
      {admin && tab === 'reconciliation' && (
        <>
          {actionButton('review', 'finance/reconcile')}
          <Table locale={locale} rows={rows} columns={['payment_id', 'code', 'status', 'created_at']} t={t} />
          <Table
            locale={locale}
            rows={(extra.unmatched_events ?? []) as Row[]}
            columns={['gateway_id', 'event_type', 'received_at']}
            t={t}
          />
        </>
      )}
      {!admin && tab === 'wallet' && (
        <>
          <Table
            locale={locale}
            rows={(extra.balances ?? []) as Row[]}
            columns={['currency', 'kind', 'balance']}
            t={t}
          />
          <div className="dash22-page-actions">
            <button
              type="button"
              className="dash22-primary-create"
              onClick={() => setPaymentDrawerOpen(true)}
            >
              <Icon name="wallet" />
              {booking ? t.pay : t.topup}
            </button>
          </div>

          <DashboardDrawer
            open={paymentDrawerOpen}
            title={
              booking
                ? (
                    t.pay ??
                    dashboard22TableCopy[locale]!.newPayment
                  )
                : (
                    t.topup ??
                    dashboard22TableCopy[locale]!.newPayment
                  )
            }
            closeLabel={dashboard22TableCopy[locale]!.close}
            onClose={() => setPaymentDrawerOpen(false)}
          >
<form
            className="scholar-form"
            onSubmit={(e) => {
              const d = fields(e);
              void act(async () => {
                const data = {
                  locale,
                  provider: d.provider,
                  ...(booking
                    ? { booking_id: booking }
                    : { amount: toMinor(d.amount!, d.currency!), currency: d.currency }),
                  ...(d.provider === 'nowpayments' ? { network: d.network } : {}),
                };
                const fingerprint = JSON.stringify(data);
                if (request.current.fingerprint !== fingerprint)
                  request.current = { fingerprint, key: crypto.randomUUID() };
                const p = await userApi<Row>('payments/create', 'POST', {
                  ...data,
                  request_key: request.current.key,
                });
                setPayment(p);
                window.history.replaceState(null, '', '?payment=' + p.id);
              });
            }}
          >
            <h3>{booking ? t.booking : t.topup}</h3>
            {booking ? (
              <bdi>{booking}</bdi>
            ) : (
              <>
                <Input name="amount" t={t} />
                {currencySelect()}
              </>
            )}
            <label>
              {t.provider}
              <select
                name="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {['wallet', 'stripe', 'paypal', 'nowpayments']
                  .filter((x) => booking || x !== 'wallet')
                  .map((p) => {
                    const methods = ((extra.methods as Row | undefined)?.methods ?? []) as Row[],
                      configured = methods.find((x) => x.provider === p);
                    return (
                      <option key={p} value={p} disabled={!configured?.enabled}>
                        {t[p.toUpperCase()]}
                        {!configured?.enabled ? ' — ' + t.notConfigured : ''}
                      </option>
                    );
                  })}
              </select>
            </label>
            {provider === 'nowpayments' && (
              <label>
                {t.network}
                <select name="network">
                  {Object.entries(
                    ((extra.methods as Row | undefined)?.networks ?? {}) as Record<string, Row>,
                  ).map(([code, n]) => (
                    <option key={code} value={code}>
                      {str(n.coin)} · {str(n.network)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p>{t.disabled}</p>
            <button
              className="button"
              disabled={
                busy ||
                !(((extra.methods as Row | undefined)?.methods ?? []) as Row[]).some(
                  (x) => x.provider === provider && x.enabled,
                )
              }
            >
              {t.pay}
            </button>
          </form>
          </DashboardDrawer>
          {payment && (
            <article className="user-card">
              <h3>{t.remaining}</h3>
              <bdi>{str(payment.invoice_number ?? payment.id)}</bdi>
              <p>{t[str(payment.status)] ?? str(payment.status)}</p>
              <p>{t[str(payment.fulfillment)] ?? ''}</p>
              <Money amount={payment.amount} decimals={Number(payment.decimals ?? 2)} />{' '}
              {str(payment.currency)}
              <p>
                {t.tax}:{' '}
                <Money amount={payment.tax ?? '0'} decimals={Number(payment.decimals ?? 2)} />
              </p>
              {!!(payment.checkout as Row)?.url && (
                <p>
                  <a className="button" href={str((payment.checkout as Row).url)} rel="noreferrer">
                    {t.checkout}
                  </a>
                </p>
              )}
              {!!(payment.checkout as Row)?.address && (
                <>
                  <p>{t.cryptoHint}</p>
                  <p>
                    {t.address}: <bdi>{str((payment.checkout as Row).address)}</bdi>
                  </p>
                  <p>
                    {t.cryptoAmount}:{' '}
                    <bdi>
                      {str((payment.checkout as Row).amount)} ·{' '}
                      {str((payment.checkout as Row).network)}
                    </bdi>
                  </p>
                </>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    setPayment(
                      await userApi<Row>('payments/' + payment.id + '/reconcile', 'POST', {}),
                    ),
                  )
                }
              >
                {t.review}
              </button>
              <a href={path('account/bookings')}>{t.bookings}</a>
            </article>
          )}
          <h3 id="payments">{t.payments}</h3>
          <Table
            locale={locale}
            rows={(extra.payments ?? []) as Row[]}
            columns={['id', 'provider', 'amount', 'currency', 'status']}
            t={t}
            actions={(r) => (
              <>
                <button onClick={() => setPayment(r)}>{t.details}</button>
                {r.status === 'SUCCESS' && (
                  <>
                    {actionButton('refundWallet', 'payments/' + r.id + '/refund', {
                      target: 'WALLET',
                      reason: 'OTHER',
                    })}
                    {r.provider !== 'nowpayments' &&
                      actionButton('refundOriginal', 'payments/' + r.id + '/refund', {
                        target: 'ORIGINAL',
                        reason: 'OTHER',
                      })}
                  </>
                )}
              </>
            )}
          />
          <p>{t.refundHint}</p>
          <details>
            <summary>{t.exchange}</summary>
            <form
              className="scholar-form"
              onSubmit={(e) => {
                const d = fields(e);
                void act(
                  async () =>
                    setQuote(
                      await userApi<Row>('accounting/quotes', 'POST', {
                        base: d.base,
                        quote: d.quote,
                        amount: toMinor(d.amount!, d.base!),
                      }),
                    ),
                  false,
                );
              }}
            >
              {currencySelect('base')}
              {currencySelect('quote')}
              <Input name="amount" t={t} />
              <button disabled={busy}>{t.quoteRate}</button>
            </form>
            {quote && (
              <>
                <p>
                  <bdi>
                    {str(quote.source_minor)} {str(quote.base)} → {str(quote.target_minor)}{' '}
                    {str(quote.quote)}
                  </bdi>
                </p>
                {actionButton('exchange', 'wallet/exchange', { quote_id: quote.id })}
              </>
            )}
          </details>
          <h3 id="history">{t.history}</h3>
          <Table
            locale={locale}
            rows={rows}
            columns={['created_at', 'description', 'kind', 'currency', 'debit', 'credit']}
            t={t}
          />
        </>
      )}
      {tab === 'payouts' && (
        <>
          {!admin && (
            <>
              <div className="dash22-page-actions">
                <button
                  type="button"
                  className="dash22-primary-create"
                  onClick={() => setPayoutDrawerOpen(true)}
                >
                  <Icon name="wallet" />
                  {t.withdraw}
                </button>
              </div>

              <DashboardDrawer
                open={payoutDrawerOpen}
                title={
                  t.withdraw ??
                  dashboard22TableCopy[locale]!.newWithdrawal
                }
                closeLabel={dashboard22TableCopy[locale]!.close}
                onClose={() => setPayoutDrawerOpen(false)}
              >
<p>{t.withdrawHint}</p>
              <form
                className="scholar-form"
                onSubmit={(e) => {
                  const d = fields(e);
                  void act(() => userApi('payouts/destinations', 'POST', { method, ...d }));
                }}
              >
                <h3>{t.addDestination}</h3>
                <label>
                  {t.method}
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="BANK">
                      {t.BANK}
                    </option>

                    <option value="PAYPAL">
                      {t.PAYPAL}
                    </option>

                    <option value="CRYPTO">
                      {t.CRYPTO}
                    </option>
                  </select>
                </label>
                {(method === 'BANK'
                  ? ['country', 'bank', 'account', 'holder']
                  : method === 'PAYPAL'
                    ? ['email']
                    : ['network', 'address']
                ).map((k) => (
                  <Input key={k} name={k} t={t} />
                ))}
                <button disabled={busy}>{t.save}</button>
              </form>
              <form
                className="scholar-form"
                onSubmit={(e) => {
                  const d = fields(e);
                  void act(() =>
                    userApi('payouts/withdrawals', 'POST', {
                      request_key: crypto.randomUUID(),
                      destination_id: d.destination_id,
                      amount: toMinor(d.amount!, d.currency!),
                      currency: d.currency,
                    }),
                  );
                }}
              >
                <label>
                  {t.destination}
                  <select name="destination_id">
                    {((extra.destinations ?? []) as Row[]).map((x) => (
                      <option value={str(x.id)} key={str(x.id)}>
                        {str(x.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <Input name="amount" t={t} />
                {currencySelect()}
                <button disabled={busy}>{t.withdraw}</button>
              </form>
              </DashboardDrawer>
            </>
          )}
          <Table
            locale={locale}
            rows={rows}
            columns={['id', 'amount', 'currency', 'method', 'status', 'provider_reference']}
            t={t}
            actions={
              admin
                ? (r) => (
                    <>
                      {r.status === 'REQUESTED' &&
                        actionButton('approve', 'payouts/admin/' + r.id + '/approve')}
                      {['REQUESTED', 'APPROVED'].includes(str(r.status)) &&
                        actionButton('reject', 'payouts/admin/' + r.id + '/reject')}
                      {r.status === 'APPROVED' &&
                        actionButton('process', 'payouts/admin/' + r.id + '/process')}
                      {r.status === 'PROCESSING' &&
                        actionButton('review', 'payouts/admin/' + r.id + '/reconcile')}
                      <button
                        onClick={() =>
                          void act(
                            async () =>
                              setDetails(
                                await userApi<Row>(
                                  'payouts/admin/' + r.id + '/details',
                                  'POST',
                                  {},
                                ),
                              ),
                            false,
                          )
                        }
                      >
                        {t.details}
                      </button>
                      {r.status === 'PROCESSING' && r.method === 'BANK' && (
                        <form
                          onSubmit={(e) => {
                            const d = fields(e);
                            void act(() =>
                              userApi('payouts/admin/' + r.id + '/complete-bank', 'POST', {
                                reference: d.reference,
                              }),
                            );
                          }}
                        >
                          <Input t={t} name="reference" />
                          <button disabled={busy}>{t.complete}</button>
                        </form>
                      )}
                      {r.status === 'PROCESSING' && r.method === 'CRYPTO' && (
                        <form
                          onSubmit={(e) => {
                            const d = fields(e);
                            void act(() =>
                              userApi('payouts/admin/' + r.id + '/verify', 'POST', {
                                code: d.verificationCode,
                              }),
                            );
                          }}
                        >
                          <Input t={t} name="verificationCode" />
                          <button disabled={busy}>{t.verify}</button>
                        </form>
                      )}
                    </>
                  )
                : undefined
            }
          />
        </>
      )}
      {tab === 'disputes' && (
        <>
          {!admin && (
            <form
              className="scholar-form"
              onSubmit={(e) => {
                const d = fields(e);
                void act(() =>
                  userApi('disputes', 'POST', { booking_id: d.booking, reason: d.reason }),
                );
              }}
            >
              <Input name="booking" t={t} />
              <label>
                {t.reason}
                <select name="reason">
                  {['NO_SHOW', 'QUALITY', 'REFUND', 'OTHER'].map((x) => (
                    <option key={x} value={x}>
                      {t[x]}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>{t.newDispute}</button>
            </form>
          )}
          <Table
            locale={locale}
            rows={rows}
            columns={['id', 'booking_id', 'reason', 'status']}
            t={t}
            actions={(r) => (
              <>
                <button
                  onClick={() =>
                    void act(async () => {
                      setActiveDispute(str(r.id));
                      setMessages(await userApi<Row[]>('disputes/' + r.id + '/messages'));
                    }, false)
                  }
                >
                  {t.details}
                </button>
                {admin && r.status === 'OPEN' && (
                  <>
                    {actionButton('resolveRefund', 'disputes/' + r.id + '/resolve', {
                      decision: 'REFUND_WALLET',
                    })}
                    {actionButton('resolveRelease', 'disputes/' + r.id + '/resolve', {
                      decision: 'RELEASE',
                    })}
                  </>
                )}
              </>
            )}
          />
          {activeDispute && (
            <>
              <ul>
                {messages.map((m) => (
                  <li key={str(m.id)}>{str(m.message)}</li>
                ))}
              </ul>
              <form
                className="scholar-form"
                onSubmit={(e) => {
                  const d = fields(e);
                  void act(async () => {
                    await userApi('disputes/' + activeDispute + '/messages', 'POST', {
                      message: d.message,
                      attachments: split(d.attachments ?? ''),
                    });
                    setMessages(await userApi<Row[]>('disputes/' + activeDispute + '/messages'));
                  }, false);
                }}
              >
                <label>
                  {t.message}
                  <textarea name="message" required maxLength={5000} />
                </label>
                <Input name="attachments" t={t} required={false} />
                <button disabled={busy}>{t.send}</button>
              </form>
            </>
          )}
        </>
      )}
      {details && (
        <aside className="user-card finance-details">
          <button onClick={() => setDetails(null)}>{t.close}</button>
          <dl>
            {Object.entries(details).map(([k, v]) => (
              <div key={k}>
                <dt>{t[k] ?? k}</dt>
                <dd>
                  <bdi>{str(v)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </section>
  );
}
