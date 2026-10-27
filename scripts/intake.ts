// npm run intake -- <from> [to]: for each garment folder in <from>, writes its
// JPEGs to [to]/<garment>/ (default data/garments) with metadata removed and
// names fixed, plus intake.json listing both hashes of every photo. Nothing
// but .jpg/.jpeg files is read; WHY.txt and note.txt are left to the person.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { intakeJpeg } from "../src/intake.ts";
import type { IntakeFile } from "../src/intake.ts";

const [from, to = join("data", "garments")] = process.argv.slice(2);
if (!from) {
  console.error("usage: npm run intake -- <from> [to]");
  process.exit(2);
}

for (const garment of readdirSync(from).sort()) {
  const dir = join(from, garment);
  if (!statSync(dir).isDirectory()) continue;
  const photos = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  if (photos.length === 0) continue;
  mkdirSync(join(to, garment), { recursive: true });
  const files: IntakeFile[] = [];
  for (const photo of photos) {
    const { file, bytes } = intakeJpeg(photo, readFileSync(join(dir, photo)));
    writeFileSync(join(to, garment, file.name), bytes);
    files.push(file);
    console.log(`${garment}/${file.name}: removed ${file.removed.length ? file.removed.join(", ") : "nothing"}`);
  }
  writeFileSync(join(to, garment, "intake.json"), JSON.stringify({ garment, files }, null, 2) + "\n");
}
