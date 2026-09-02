import { expect, test } from "@playwright/test";

test.describe("beta local · recorrido crítico", () => {
  test("registro, publicación, descubrimiento y reutilización", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /datos iot abiertos/i })).toBeVisible();

    // Start from the publication guard so registration returns directly to
    // the real, authenticated publication flow at both supported viewports.
    await page.goto("/publish");
    await expect(page.getByRole("heading", { name: /inicia sesión para publicar/i })).toBeVisible();
    await page.locator(".auth-required").getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page).toHaveURL(/\/auth\/realms\/openiotdata\/(?:login-actions\/registration|protocol\/openid-connect\/registrations)/);
    const suffix = `${Date.now()}-${testInfo.project.name}`;
    const username = `e2e-${suffix}`;
    const password = "E2e-local-2026!";
    await page.getByLabel(/username|usuario/i).fill(username);
    await page.getByLabel(/correo electrónico|email/i).fill(`${username}@example.invalid`);
    await page.getByLabel(/first name|nombre/i).fill("E2E");
    await page.getByLabel(/last name|apellido/i).fill("Local");
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password-confirm"]').fill(password);
    await page.getByRole("button", { name: /registrarse|register/i }).click();
    await expect(page).toHaveURL(/\/publish/);

    await expect(page.getByRole("heading", { name: /publicar un dataset/i })).toBeVisible();
    // Exercise the real logout/login cycle before publication.
    const navToggle = page.getByRole("button", { name: "Abrir navegación" });
    if (await navToggle.isVisible()) await navToggle.click();
    await page.getByRole("button", { name: "Salir" }).click();
    if (await navToggle.isVisible()) await navToggle.click();
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/auth\/realms\/openiotdata\/protocol\/openid-connect\/auth/);
    await page.getByLabel(/username|usuario/i).fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /ingresar|sign in/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.evaluate(() => window.localStorage.removeItem("openiotdata:publish-draft"));

    // Validate the accessible error summary in an isolated page so the main
    // publication form starts with a clean, hydrated draft.
    const validationPage = await page.context().newPage();
    await validationPage.addInitScript(() => window.localStorage.removeItem("openiotdata:publish-draft"));
    await validationPage.goto("/publish");
    await validationPage.getByRole("button", { name: /continuar/i }).click();
    await expect(validationPage.locator(".form-error-summary")).toContainText(/revisa/i);
    await expect(validationPage.locator("#title")).toHaveAttribute("aria-invalid", "true");
    await validationPage.locator("#title").focus();
    await expect(validationPage.locator("#title")).toBeFocused();
    await validationPage.close();
    await page.evaluate(() => window.localStorage.removeItem("openiotdata:publish-draft"));
    await page.goto("/publish");

    await page.getByLabel("Título").fill("Dataset E2E de calidad del aire");
    await page.getByLabel("Descripción").fill("Mediciones locales para verificar el recorrido completo de publicación.");
    await page.getByLabel("Tema").selectOption({ label: "Ambiente" });
    await page.getByRole("button", { name: /continuar/i }).click();
    await page.setInputFiles("#resource-file", { name: "e2e-air.csv", mimeType: "text/csv", buffer: Buffer.from("observed_at,sensor_id,value,latitude,longitude\n2026-01-01T00:00:00Z,S-1,12.5,4.7,-74.0\n2026-01-01T01:00:00Z,S-1,13.5,4.7005,-74.0005\n") });
    await page.locator(".wizard-actions").getByRole("button", { name: /cargando recurso|continuar/i }).click();
    await expect(page.locator("legend", { hasText: /revisa el esquema inferido/i })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/campos detectados/i)).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: /continuar/i }).click();
    await page.getByLabel("Campo de medida").selectOption("value");
    await page.getByLabel("Identificador de sensor").selectOption("sensor_id");
    await page.getByRole("button", { name: /continuar/i }).click();
    await page.getByLabel("CC BY 4.0").check();
    await page.getByLabel(/confirmo que tengo autorización/i).check();
    await page.getByRole("button", { name: /publicar versión/i }).click();
    await expect(page.getByRole("heading", { name: /dataset publicado/i })).toBeVisible({ timeout: 120_000 });

    await page.getByRole("link", { name: /abrir dataset/i }).click();
    await expect(page.getByRole("heading", { name: /dataset e2e/i })).toBeVisible();
    // A second request exercises dynamic metadata/SSR for a non-demo slug in
    // the read-only production container and guards against prerender cache
    // writes (the previous failure surfaced only on this navigation).
    await page.reload();
    await expect(page.getByRole("heading", { name: /dataset e2e/i })).toBeVisible();
    await page.getByRole("button", { name: "Datos" }).click();
    await expect(page.getByRole("heading", { name: /a lo largo del tiempo/i })).toBeVisible();
    await page.getByRole("button", { name: "Mapa" }).click();
    await expect(page.getByText(/puntos de captura|cobertura espacial/i)).toBeVisible();
    await page.getByRole("button", { name: "Archivos" }).click();
    await expect(page.getByRole("link", { name: /descargar/i }).first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});
