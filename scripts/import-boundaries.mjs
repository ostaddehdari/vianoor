import ts from 'typescript';
import path from 'node:path';
export function importSpecifiers(text, file = 'source.ts') {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]))
        imports.push(node.arguments[0].text);
      else imports.push('<computed-import>');
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      imports.push(node.moduleReference.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}
export function boundaryViolation(file, specifier) {
  const normalized = file.replaceAll('\\', '/');
  const [group, unit] = normalized.split('/');
  if (specifier === '<computed-import>')
    return 'Computed module paths require explicit architecture review';
  if (
    specifier.startsWith('@vianoor/') &&
    !['@vianoor/contracts', '@vianoor/service-runtime', '@vianoor/ui'].some(
      (p) => specifier === p || specifier.startsWith(p + '/'),
    )
  )
    return 'Only technical shared packages may be imported';
  if (group === 'apps' && specifier.startsWith('@vianoor/service-runtime'))
    return 'Browser applications cannot import backend runtime';
  if (group === 'services' && specifier.startsWith('@vianoor/ui'))
    return 'Services cannot import UI';
  if (specifier.startsWith('.')) {
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(normalized), specifier),
    );
    if (!resolved.startsWith(`${group}/${unit}/`))
      return 'Relative import escapes workspace boundary';
  }
  if (/^(services|apps)\//.test(specifier) || specifier.startsWith('/'))
    return 'Direct app or service import forbidden';
  return null;
}
