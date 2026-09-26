export function identityConfig(env = process.env) {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing configuration: ${name}`);
    return value;
  };
  const publicUrl = new URL(required('AUTH_PUBLIC_URL'));
  const development = env.AUTH_DEVELOPMENT === '1';
  if (
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.username ||
    publicUrl.password ||
    (publicUrl.protocol !== 'https:' &&
      !(
        development &&
        publicUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(publicUrl.hostname)
      ))
  )
    throw new Error('AUTH_PUBLIC_URL must be a trusted HTTPS URL');
  const apiKey = required('AUTH_INTERNAL_KEY');
  const mailKey = Buffer.from(required('AUTH_MAIL_KEY'), 'hex');
  if (apiKey.length < 48 || mailKey.length !== 32)
    throw new Error('Invalid identity secret length');
  const smtpPort = Number(required('SMTP_PORT'));
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    throw new Error('Invalid SMTP port');
  return {
    publicUrl: publicUrl.href.replace(/\/$/, ''),
    apiKey,
    mailKey,
    development,
    smtp: {
      host: required('SMTP_HOST'),
      port: smtpPort,
      secure: smtpPort === 465,
      requireTLS: !development,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: required('SMTP_PASSWORD') } } : {}),
    },
    from: required('SMTP_FROM'),
  };
}
export type IdentityConfig = ReturnType<typeof identityConfig>;
