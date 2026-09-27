import fs from 'node:fs';
import ts from 'typescript';
const root = 'packages/ui/src';
const names = [
  'copy',
  'authCopy',
  'usersCopy',
  'scholarsCopy',
  'schedulingCopy',
  'expertsPublicCopy',
  'threeCalendarCopy',
  'messages',
];
for (const entry of fs.readdirSync(root).filter((x) => x.endsWith('.ts') && !x.endsWith('.d.ts'))) {
  const path = root + '/' + entry;
  let source = fs.readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const imports = new Set();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const method = names.includes(name)
        ? 'createDictionary'
        : entry === 'catalog.ts' && ['roles', 'publicPages', 'sectionNames'].includes(name)
          ? 'localizeTree'
          : null;
      if (method && !node.initializer.getText(ast).startsWith(method + '(')) {
        edits.push({
          start: node.initializer.getStart(ast),
          end: node.initializer.end,
          value: `${method}('${name}', ${node.initializer.getText(ast)})`,
        });
        imports.add(method);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  if (imports.size)
    source = `import { ${[...imports].join(', ')} } from './localization-runtime';\n` + source;
  fs.writeFileSync(path, source);
}
