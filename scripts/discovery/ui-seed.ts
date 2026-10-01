import { sessionsCopy } from '../../packages/ui/src/sessions-copy.js';
import { homeCopy } from '../../packages/ui/src/home-copy.js';
import { servicesCopy } from '../../packages/ui/src/services-copy.js';
import { expertProfileCopy } from '../../packages/ui/src/expert-profile-copy.js';
import { communicationCopy } from '../../packages/ui/src/communication-copy.js';
import { financeCopy } from '../../packages/ui/src/finance-copy.js';
import { discoveryCopy } from '../../packages/ui/src/discovery-copy.js';
import { dashboard22Copy } from '../../packages/ui/src/dashboard22-copy.js';
import { dashboard22OverviewCopy } from '../../packages/ui/src/dashboard22-overview-copy.js';
import { dashboard22TableCopy } from '../../packages/ui/src/dashboard22-table-copy.js';
import { consultation23Copy } from '../../packages/ui/src/consultation23-copy.js';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { copy } from '../../packages/ui/src/copy.js';
import { authCopy } from '../../packages/ui/src/auth-copy.js';
import { usersCopy } from '../../packages/ui/src/users-copy.js';
import { scholarsCopy } from '../../packages/ui/src/scholars-copy.js';
import { schedulingCopy } from '../../packages/ui/src/scheduling-copy.js';
import { expertsPublicCopy } from '../../packages/ui/src/experts-public-copy.js';
import { threeCalendarCopy } from '../../packages/ui/src/three-calendar-copy.js';
import { messages } from '../../packages/ui/src/messages.js';
import { roles, publicPages, sectionNames } from '../../packages/ui/src/catalog.js';
type Item = { key: string; module: string; en: string; fa?: string; ar?: string };
const items = new Map<string, Item>();
function values(key: string, en: unknown, fa?: unknown, ar?: unknown) {
  if (typeof en === 'string') {
    if (en.trim())
      items.set(key, {
        key,
        module: key.split('.')[0]!.toLowerCase(),
        en,
        ...(typeof fa === 'string' && fa.trim() ? { fa } : {}),
        ...(typeof ar === 'string' && ar.trim() ? { ar } : {}),
      });
    return;
  }
  if (en && typeof en === 'object')
    for (const [k, v] of Object.entries(en))
      values(
        key + '.' + k,
        v,
        (fa as Record<string, unknown> | undefined)?.[k],
        (ar as Record<string, unknown> | undefined)?.[k],
      );
}
function visit(key: string, value: unknown) {
  if (value && typeof value === 'object') {
    if ('en' in value && 'fa' in value) {
      const dict = value as Record<string, unknown>;
      values(key, dict.en, dict.fa, dict.ar);
      return;
    }
    for (const [k, v] of Object.entries(value)) visit(key + '.' + k, v);
  }
}
for (const [key, value] of Object.entries({
  discoveryCopy,
  dashboard22: dashboard22Copy,
  dashboard22Overview: dashboard22OverviewCopy,
  dashboard22Table: dashboard22TableCopy,
  consultation23: consultation23Copy,
  home21: homeCopy,
  services21: servicesCopy,
  expertProfile21: expertProfileCopy,
  financeCopy,
  communicationCopy,
  sessionsCopy,
  copy,
  authCopy,
  usersCopy,
  scholarsCopy,
  schedulingCopy,
  expertsPublicCopy,
  threeCalendarCopy,
  messages,
  roles,
  publicPages,
  sectionNames,
}))
  visit(key, value);
for (const file of readdirSync('packages/ui/src').filter((f) => /\.tsx?$/.test(f))) {
  const source = readFileSync('packages/ui/src/' + file, 'utf8'),
    ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  function literal(node: ts.Node): unknown {
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
      return literal(node.expression);
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => [
            ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '',
            literal(p.initializer),
          ]),
      );
    return undefined;
  }
  function scan(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'localizeTree'
    ) {
      const [namespace, tree] = node.arguments;
      if (namespace && tree && ts.isStringLiteral(namespace)) visit(namespace.text, literal(tree));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'localizedText'
    ) {
      const [, key, en, fa] = node.arguments;
      if (key && en && ts.isStringLiteral(key) && ts.isStringLiteral(en))
        values(key.text, en.text, fa && ts.isStringLiteral(fa) ? fa.text : undefined);
    }
    ts.forEachChild(node, scan);
  }
  scan(ast);
}
writeFileSync(
  'scripts/discovery/ui-seed.json',
  JSON.stringify(
    [...items.values()].sort((a, b) => a.key.localeCompare(b.key)),
    null,
    2,
  ) + '\n',
);
console.log('Bootstrap UI keys:', items.size);
