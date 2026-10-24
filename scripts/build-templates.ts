/*
 * Usage: npm run templates
 * Writes the Excel upload templates to ./templates/ so Finance can find them
 * in the repository. The portal builds the same files on the fly at
 * /api/admin/templates/<kind>, so the two never drift apart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES, buildTemplate, type UploadKind } from '../src/lib/upload/templates';

async function main() {
  const outDir = path.join(process.cwd(), 'templates');
  fs.mkdirSync(outDir, { recursive: true });
  for (const kind of Object.keys(TEMPLATES) as UploadKind[]) {
    const buf = await buildTemplate(kind);
    const file = path.join(outDir, TEMPLATES[kind].fileName);
    fs.writeFileSync(file, buf);
    console.log(`wrote ${path.relative(process.cwd(), file)} (${buf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
