import ts from "typescript";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("loads only the active bounded exception projection and never performs row details", async () => {
  const source = await readFile(
    resolve(
      import.meta.dirname,
      "../../app/(authenticated)/excepciones/page.tsx",
    ),
    "utf8",
  );

  expect(source.match(/listBlockedExceptions\(/g)).toHaveLength(1);
  expect(source.match(/verificationFailures\(/g)).toHaveLength(1);
  expect(source.match(/countOperationalExceptions\(/g)).toHaveLength(1);
  expect(source.indexOf("countOperationalExceptions(")).toBeLessThan(
    source.indexOf('selected === "blocked"'),
  );
  expect(source).toContain('selected === "blocked"');
  expect(source).toContain('selected === "failed"');
  expect(source).toContain("exceptionCounts.blocked,");
  expect(source).toContain("exceptionCounts.failed,");
  expect(source).not.toContain("blocked.items.length");
  expect(source).not.toContain("failures.items.length");
  expect(source).not.toContain("requestReadRepository.list(");
  expect(source).not.toContain("requestReadRepository.detail(");
});


test("binds verified overdue projection, count and labels to the rendered exceptions view", async () => {
  const source = await readFile(resolve(import.meta.dirname,"../../app/(authenticated)/excepciones/page.tsx"),"utf8");
  const ast = ts.createSourceFile("page.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations = new Map<string,ts.Expression>();
  const views: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text,node.initializer);
    if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text==='ExceptionsView') views.push(node);
    ts.forEachChild(node,visit);
  }
  visit(ast);
  const invitation = declarations.get('invitations');
  expect(invitation && ts.isConditionalExpression(invitation)).toBe(true);
  if (!invitation || !ts.isConditionalExpression(invitation)) throw new Error('Missing bounded invitation projection');
  expect(invitation.condition.getText(ast)).toBe('selected === "expiredInvites"');
  expect(ts.isAwaitExpression(invitation.whenTrue)).toBe(true);
  const loaded = (invitation.whenTrue as ts.AwaitExpression).expression;
  expect(ts.isCallExpression(loaded)).toBe(true);
  if (!ts.isCallExpression(loaded)) throw new Error('Missing invitation reader call');
  expect(loaded.expression.getText(ast)).toBe('requestReadRepository.listOverdueInvitations');
  expect(loaded.arguments[0].getText(ast)).toBe('authorization');
  const options = loaded.arguments[1] as ts.ObjectLiteralExpression;
  expect(options.properties.map(property=>property.name?.getText(ast))).toEqual(['at','cursor']);
  expect((options.properties[0] as ts.PropertyAssignment).initializer.getText(ast)).toBe('invitationAt');
  expect((options.properties[1] as ts.PropertyAssignment).initializer.getText(ast)).toBe('query.cursor');
  const count = declarations.get('invitationCount') as ts.AwaitExpression;
  expect(ts.isAwaitExpression(count)).toBe(true);
  const call = count.expression as ts.CallExpression;
  expect(call.expression.getText(ast)).toBe('requestReadRepository.countOverdueInvitations');
  expect(call.arguments.map(argument=>argument.getText(ast))).toEqual(['authorization','invitationAt']);
  expect(views).toHaveLength(1);
  const props = new Map(views[0].attributes.properties.filter(ts.isJsxAttribute).map(attribute=>[
    attribute.name.getText(ast),attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText(ast) : null,
  ]));
  expect(props.get('invitations')).toBe('invitations');
  expect(props.get('counts')).toBe('counts');
  expect(props.get('t')).toBe('t');
  expect(props.get('locale')).toBe('locale');
  const counts = declarations.get('counts') as ts.ObjectLiteralExpression;
  const expired = counts.properties.find(property=>property.name?.getText(ast)==='expiredInvites') as ts.PropertyAssignment;
  const formatted = expired.initializer as ts.CallExpression;
  expect(formatted.expression.getText(ast)).toBe('formatOperationalBadgeCount');
  expect(formatted.arguments[0].getText(ast)).toBe('invitationCount');
});
