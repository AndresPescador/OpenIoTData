import { expect, test } from "@playwright/test";

async function openNavigationIfNeeded(page: import("@playwright/test").Page) {
  const navToggle = page.getByRole("button", { name: "Abrir navegación" });
  if (await navToggle.isVisible()) await navToggle.click();
}

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

    // Continue through the owner workspace: versioning, token lifecycle and
    // archival are real authenticated operations against the same dataset.
    await page.goto("/my-datasets");
    await page.getByRole("link", { name: "Dataset E2E de calidad del aire", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Historial de versiones" })).toBeVisible();
    await page.getByLabel(/notas de la nueva versión/i).fill("Actualización E2E desde la interfaz de gestión");
    await page.getByRole("button", { name: "Crear versión" }).click();
    await expect(page.getByRole("heading", { name: /versión 2 en preparación/i })).toBeVisible();
    await page.setInputFiles("#version-resource", {
      name: "e2e-air-v2.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("observed_at,sensor_id,value,latitude,longitude\n2026-01-02T00:00:00Z,S-1,14.5,4.7,-74.0\n"),
    });
    await page.getByRole("button", { name: "Cargar y procesar" }).click();
    await expect(page.getByText("Recurso procesado")).toBeVisible({ timeout: 120_000 });
    const publishVersion = page.getByRole("button", { name: "Publicar versión 2" });
    await expect(publishVersion).toBeEnabled({ timeout: 30_000 });
    await publishVersion.click();
    await expect(page.getByRole("heading", { name: /versión 2 en preparación/i })).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".version-list").getByText("Actualización E2E desde la interfaz de gestión")).toBeVisible();

    await page.getByLabel(/nombre de la credencial/i).fill("Gateway E2E navegador");
    await page.getByRole("button", { name: "Crear token" }).click();
    const oneTimeSecret = page.locator(".token-secret");
    await expect(oneTimeSecret).toContainText("Copia este secreto ahora");
    await expect(oneTimeSecret.locator("code")).toHaveText(/^oidt_/);
    await oneTimeSecret.getByRole("button", { name: "Cerrar" }).click();
    await expect(oneTimeSecret).toBeHidden();
    const tokenRow = page.locator(".token-list article", { hasText: "Gateway E2E navegador" });
    await tokenRow.getByRole("button", { name: "Revocar" }).click();
    await expect(tokenRow.getByText("Revocado")).toBeVisible();

    await page.getByRole("button", { name: "Archivar", exact: true }).click();
    const archiveConfirmation = page.getByRole("button", { name: "Sí, archivar" });
    await expect(archiveConfirmation).toBeFocused();
    await archiveConfirmation.click();
    await expect(page).toHaveURL(/\/my-datasets$/);

    expect(consoleErrors).toEqual([]);
  });

  test("moderación autorizada resuelve un reporte", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const reason = `Privacidad E2E ${Date.now()}-${testInfo.project.name}`;
    const reportResponse = await request.post("/api/v1/datasets/ruido-ambiental-bogota-demostracion/reports", {
      data: { reason, details: "Reporte sintético creado por Playwright para validar la cola." },
    });
    expect(reportResponse.status()).toBe(201);

    await page.goto("/");
    await openNavigationIfNeeded(page);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.getByLabel(/username|usuario/i).fill("demo.moderator");
    await page.locator('input[name="password"]').fill("moderator-local-only");
    await page.getByRole("button", { name: /ingresar|sign in/i }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Moderación y seguridad" })).toBeVisible();
    const reportRow = page.locator(".moderation-table tbody tr", { hasText: reason });
    await expect(reportRow).toContainText("open");
    await reportRow.getByRole("button", { name: "Resolver" }).click();
    await expect(reportRow).toContainText("Decisión registrada");
    await expect(reportRow).toContainText("resolved");
  });
});
