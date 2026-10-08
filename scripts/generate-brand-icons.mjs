// Run with: node --experimental-strip-types scripts/generate-brand-icons.mjs
// SVG, ICO and iOS PNG are exports of the same Services lotus, not separate artwork.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildLotusFaviconSvg } from "../src/lib/brand-lotus.ts";

const root = new URL("../", import.meta.url);
const svg = buildLotusFaviconSvg();
await writeFile(new URL("public/brand/lotus-favicon.svg", root), `${svg}\n`);
// Keep old saved default URLs working without bringing back the retired chart mark.
await writeFile(new URL("public/brand/zen-favicon.svg", root), `${svg}\n`);
await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(fileURLToPath(new URL("public/brand/lotus-apple-touch-icon.png", root)));

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index]; header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
});
await writeFile(new URL("src/app/favicon.ico", root), Buffer.concat([header, ...images]));
console.info("Generated lotus SVG, favicon.ico (16/32/48px), and 180px Apple touch icon.");
