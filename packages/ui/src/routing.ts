import registry from './page-registry.json';
import { roles, publicPages } from './catalog';
import { usersCopy } from './users-copy';
export { roles, publicPages, sectionNames } from './catalog';
export { copy } from './copy';
export type { RoleId } from './catalog';
export const examples: Record<string, string[]> = {
  services: ['consultation', 'questions', 'events'],
  topics: ['family', 'faith', 'parenting', 'growth'],
  experts: ['mina', 'ali', 'sara'],
  help: ['getting-started', 'choosing-an-expert'],
  announcements: ['welcome'],
  policies: ['privacy', 'terms'],
  questions: ['listening'],
  library: ['listening', 'better-questions', 'small-steps'],
  events: ['mindful-family'],
  collections: ['everyday-growth'],
  channels: ['sample-expert'],
};
export function rolePath(id: string) {
  return id === 'ai' ? 'admin/ai' : id;
}
export function dashboardSections(id: string) {
  if (id === 'secretary') return ['requests', 'calendar', 'messages'];
  if (id === 'auditor') return ['audit'];
  const prefix = `/[locale]/${rolePath(id === 'call' ? 'call-center' : id)}/`;
  const sections = registry
    .filter((p) => p.path.startsWith(prefix))
    .map((p) => p.path.slice(prefix.length))
    .filter((s) => s && !s.includes('/') && !s.includes('['));
  return [
    ...new Set(sections.length ? sections : ['questions', 'calendar', 'messages', 'settings']),
  ];
}
export function routeInfo(path: string, app: 'web' | 'admin' = 'web') {
  if (path === 'call-center' || path.startsWith('call-center/'))
    path = path.replace(/^call-center/, 'call');
  if (/^members\/[A-Za-z0-9]{13}$/.test(path)) return { kind: 'member', path };
  const [workspace, section = ''] = path.split('/');
  if (
    Object.hasOwn(usersCopy.en.roleNames, workspace ?? '') &&
    path.split('/').length <= 2 &&
    [
      '',
      'profile',
      'users',
      'forms',
      'organizations',
      'audit',
      'requests',
      'messages',
      'settings',
      'activity',
      'calendar',
      ...dashboardSections(workspace ?? ''),
    ].includes(section)
  )
    return { kind: 'dashboard', path, role: workspace!, section };
  if (!path) return { kind: app === 'web' ? 'home' : 'gallery', path };
  if (path === 'dashboards') return { kind: 'gallery', path };
  if (path.startsWith('preview/')) {
    const [, id, ...rest] = path.split('/');
    if (!roles.some((r) => r.id === id)) return null;
    if (
      rest.length &&
      ![...dashboardSections(id!), 'activity', 'calendar', 'messages', 'settings'].includes(
        rest.join('/'),
      )
    )
      return null;
    return { kind: 'dashboard', path, role: id!, section: rest.join('/') };
  }
  if (/^responder\/(questions|calendar|messages|settings)$/.test(path))
    return { kind: 'dashboard', path, role: 'responder', section: path.split('/')[1]! };
  if (path === 'responder') return { kind: 'dashboard', path, role: 'responder', section: '' };
  const row = registry.find((p) => p.app === app && p.path.replace('/[locale]/', '') === path);
  const root = path.split('/')[0]!;
  if (
    row &&
    row.audience !== 'public' &&
    row.audience !== 'guest' &&
    row.audience !== 'authenticated'
  ) {
    return {
      kind: 'dashboard',
      path,
      role: path.startsWith('admin/ai') ? 'ai' : root,
      section: path.replace(path.startsWith('admin/ai') ? 'admin/ai' : root, '').replace(/^\//, ''),
    };
  }
  if (row?.audience === 'guest') return { kind: 'auth', path };
  if (row?.audience === 'authenticated')
    return {
      kind: 'dashboard',
      path,
      role: 'account',
      section: root === 'settings' ? path.split('/')[1]! : root,
    };
  if (
    publicPages.some((p) => p.path === path) ||
    (row?.audience === 'public' && !path.includes('['))
  )
    return { kind: 'public', path };
  const parts = path.split('/');
  if (parts.length === 2 && examples[root]?.includes(parts[1]!)) return { kind: 'detail', path };
  return null;
}
export function pagePaths(app: 'web' | 'admin') {
  const paths = registry
    .filter(
      (p) =>
        p.app === app &&
        !p.path.includes('[slug]') &&
        !p.path.includes('[id]') &&
        !p.path.includes('[provider]'),
    )
    .map((p) => p.path.replace('/[locale]/', ''))
    .filter(Boolean);
  paths.push(
    'dashboards',
    'responder',
    ...['questions', 'calendar', 'messages', 'settings'].map((s) => `responder/${s}`),
  );
  for (const role of Object.keys(usersCopy.en.roleNames)) paths.push(role);
  paths.push(
    'account/profile',
    'admin/users',
    'admin/forms',
    'admin/organizations',
    'admin/audit',
    'organization/organizations',
    'auditor/audit',
  );
  for (const r of roles) {
    paths.push(`preview/${r.id}`);
    for (const section of [
      ...dashboardSections(r.id),
      'activity',
      'calendar',
      'messages',
      'settings',
    ])
      paths.push(`preview/${r.id}/${section}`);
  }
  if (app === 'web')
    for (const [root, slugs] of Object.entries(examples))
      for (const slug of slugs) paths.push(`${root}/${slug}`);
  for (const role of Object.keys(usersCopy.en.roleNames))
    for (const section of dashboardSections(role)) paths.push(`${role}/${section}`);
  return [...new Set(paths)].filter((path) => routeInfo(path, app));
}
