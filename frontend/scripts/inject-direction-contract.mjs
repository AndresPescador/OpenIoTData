import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(".next/server/app");
const contract = "<!-- impeccable:direction-contract seed=4c21459f; world=topographic-survey-sheet; thesis=open-sensor-data-surveyed-legible-reusable -->";

async function visit(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(target);
    if (!entry.name.endsWith(".html")) return;
    const html = await fs.readFile(target, "utf8");
    if (/<body[^>]*><!-- impeccable:direction-contract seed=4c21459f;/.test(html)) return;
    await fs.writeFile(target, html.replace(/(<body[^>]*>)/, `$1${contract}`));
  }));
}

await visit(root);
