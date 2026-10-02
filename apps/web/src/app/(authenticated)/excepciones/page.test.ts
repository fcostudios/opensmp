import { readFile } from "node:fs/promises";
import ts from "typescript";
import { describe, expect, it } from "vitest";

async function componentProps(filename: string, component: string) {
  const source = await readFile(new URL(filename, import.meta.url), "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === component) elements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(elements).toHaveLength(1);
  return new Map(elements[0].attributes.properties.filter(ts.isJsxAttribute).map(attribute => [
    attribute.name.getText(ast),
    attribute.initializer && ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression?.getText(ast) : null,
  ]));
}

describe("exceptions composition", () => {
  it("binds typed blocked request and locale composers in the renderer", async () => {
    const props = await componentProps("./exceptions-view.tsx", "BlockedRequestsTable");
    expect(props.get("items")).toBe("blocked.items.map(toBlockedRequestItem)");
    expect(props.get("labels")).toBe("createBlockedRequestsLabels(t)");
  });

  it("passes loaded failures and validated retry feedback to the renderer and protected retry action to rows", async () => {
    const page = await componentProps("./page.tsx", "ExceptionsView");
    expect(page.get("failures")).toBe("failures");
    expect(page.get("retryErrorKey")).toBe("retryErrorKey");
    const rows = await componentProps("./exceptions-view.tsx", "ChecklistExceptionsList");
    expect(rows.get("retryAction")).toBe("retryProvisioning");
    expect(rows.get("failures")).toBe("failures.items");
  });
});
