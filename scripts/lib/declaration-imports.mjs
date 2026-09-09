import { relative, dirname, sep } from 'node:path';
import ts from 'typescript';

/** Relocate private workspace references while preserving one shared declaration graph. */
export function rewriteDeclarationImports(
  source,
  outputPath,
  moduleDeclarations,
) {
  const document = ts.createSourceFile(
    'entry.d.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const replacements = [];
  const record = (literal) => {
    if (!literal || !ts.isStringLiteral(literal)) return;
    const target = moduleDeclarations.get(literal.text);
    if (target === undefined) {
      if (literal.text.startsWith('@harapter/'))
        throw new Error(
          'Declaration references an undeclared internal Harapter module.',
        );
      return;
    }
    let specifier = relative(dirname(outputPath), target)
      .split(sep)
      .join('/')
      .replace(/\.d\.ts$/u, '.js');
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    replacements.push({
      start: literal.getStart(document),
      end: literal.end,
      value: JSON.stringify(specifier),
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      record(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      record(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(document);
  let rewritten = source;
  for (const edit of replacements.sort(
    (left, right) => right.start - left.start,
  ))
    rewritten =
      rewritten.slice(0, edit.start) + edit.value + rewritten.slice(edit.end);
  return rewritten.replace(/^\/\/# sourceMappingURL=.*$/gmu, '');
}
