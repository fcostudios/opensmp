import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

const keycloakBrowserUrl = "http://keycloak.localhost:18184";
const authTestCompanyId = "20000000-0000-0000-0000-000000000451";

async function signInEmployee(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await page.locator("#username").fill("employee");
  await page.locator("#password").fill("employee-test-password");
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL("/solicitudes");
}

async function expectVisibleFocusIndicator(
  locator: Locator,
): Promise<void> {
  const focusStyle = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(
    focusStyle.boxShadow !== "none" ||
      (focusStyle.outlineStyle !== "none" &&
        focusStyle.outlineWidth !== "0px"),
  ).toBe(true);
}

test("authenticated shell preserves keyboard access, role scope, and responsive chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signInEmployee(page);

  const menuButton = page.getByRole("button", {
    name: /Menú|Menu/,
  });
  await expect(menuButton).toBeVisible();
  const menuBox = await menuButton.boundingBox();
  expect(menuBox?.width).toBeGreaterThanOrEqual(44);
  expect(menuBox?.height).toBeGreaterThanOrEqual(44);

  await menuButton.focus();
  await expectVisibleFocusIndicator(menuButton);
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", {
    name: /Navegación móvil|Mobile navigation/,
  });
  await expect(sheet).toBeVisible();
  const closeButton = sheet.getByRole("button", {
    name: /Cerrar menú|Close menu/,
  });
  await expect(closeButton).toBeFocused();
  await expectVisibleFocusIndicator(closeButton);
  await expect(
    sheet.getByRole("link", { name: /Mis solicitudes|My requests/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(sheet.getByRole("link")).toHaveCount(1);
  await expect(sheet.getByText(/Panel general|Dashboard/)).toHaveCount(0);
  await expect(sheet.getByTestId("btn_logout_mobile")).toBeVisible();
  await expect(sheet.getByLabel(/Idioma|Language/)).toBeVisible();

  await sheet.getByTestId("btn_logout_mobile").focus();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(menuButton).toBeFocused();

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(menuButton).toBeHidden();
  const intermediateNavigation = page.getByRole("navigation", {
    name: /Navegación principal|Main navigation/,
  });
  await expect(intermediateNavigation).toBeVisible();
  const intermediateRail = page.getByTestId("desktop-rail");
  expect((await intermediateRail.boundingBox())?.width).toBe(64);
  const intermediateActiveLink = intermediateNavigation.getByRole("link", {
    name: /Mis solicitudes|My requests/,
  });
  await expect(intermediateActiveLink).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(intermediateActiveLink.locator("span")).toHaveCSS(
    "position",
    "absolute",
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopNavigation = page.getByRole("navigation", {
    name: /Navegación principal|Main navigation/,
  });
  await expect(desktopNavigation).toBeVisible();
  const desktopRail = page.getByTestId("desktop-rail");
  const railBox = await desktopRail.boundingBox();
  expect(railBox?.width).toBe(248);
  const desktopActiveLink = desktopNavigation.getByRole("link", {
    name: /Mis solicitudes|My requests/,
  });
  await expect(desktopActiveLink).toHaveAttribute("aria-current", "page");
  await expect(desktopActiveLink.locator("span")).toHaveCSS(
    "position",
    "static",
  );

  const shellHeader = page.locator('[data-shell-slot="header"]');
  const localeSelector = shellHeader.getByLabel(/Idioma|Language/);
  await localeSelector.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(
    shellHeader.getByRole("heading", { name: "My requests", level: 1 }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(shellHeader.getByLabel("Language")).toHaveValue("en");

  await shellHeader.getByLabel("Language").selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es-EC");
  await expect(
    shellHeader.getByRole("heading", {
      name: "Mis solicitudes",
      level: 1,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es-EC");
  await expect(shellHeader.getByLabel("Idioma")).toHaveValue("es");

  await expect(page.getByText("Notifications")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
  await expect(page.getByRole("main")).toBeVisible();
});

test("a dynamic detail route renders its authorized entity label without leaking its id", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await page.locator("#username").fill("viewer");
  await page.locator("#password").fill("viewer-test-password");
  await page.locator("#kc-login").click();

  await expect(page).toHaveURL(`/companias/${authTestCompanyId}`);
  const breadcrumbs = page.getByRole("navigation", {
    name: /Migas de pan|Breadcrumbs/,
  });
  await expect(breadcrumbs).toContainText("Authentication Test Company");
  await expect(breadcrumbs).not.toContainText(/Detalle|details/i);
  await expect(breadcrumbs).not.toContainText(authTestCompanyId);

  await page.goto(
    "/organizaciones/20000000-0000-0000-0000-000000000461",
  );
  await expect(page).toHaveURL("/acceso-denegado");
  await page.goto(
    "/companias/20000000-0000-0000-0000-000000000499",
  );
  await expect(page).toHaveURL("/acceso-denegado");
});
