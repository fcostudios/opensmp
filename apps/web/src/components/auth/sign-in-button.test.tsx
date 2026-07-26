import { Children, isValidElement, type ReactNode } from "react";
import { expect, test } from "vitest";

import { SignInButton } from "./sign-in-button";

function allElements(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  const children = Children.toArray(
    (node.props as { children?: ReactNode }).children,
  );
  return [node, ...children.flatMap(allElements)];
}

test("renders only the corporativo redirect action and never credential fields", () => {
  const component = SignInButton();
  const elements = allElements(component);

  expect(component.type).toBe("form");
  expect(component.props.action).toBe("/auth/signin");
  expect(component.props.method).toBe("get");
  expect(
    elements.some(
      (element) =>
        isValidElement(element) &&
        element.type === "button" &&
        (element.props as Record<string, unknown>)["data-testid"] ===
          "btn_continue_corporativo",
    ),
  ).toBe(true);
  expect(
    elements.some(
      (element) =>
        isValidElement(element) &&
        element.type === "input" &&
        ["password", "otp", "totp"].includes(
          String(
            (element.props as Record<string, unknown>).type ??
              (element.props as Record<string, unknown>).name,
          ).toLowerCase(),
        ),
    ),
  ).toBe(false);
});
