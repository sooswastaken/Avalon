import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const publicDir = new URL("../public/", import.meta.url);
const source = await readFile(new URL("favicon.svg", publicDir), "utf8");

for (const size of [192, 512]) {
  const icon = new Resvg(source, { fitTo: { mode: "width", value: size } });
  await writeFile(new URL(`pwa-${size}x${size}.png`, publicDir), icon.render().asPng());
}

// Inset the artwork to keep the crown and sword inside the maskable safe circle.
const maskable = source.replace(
  /(<svg\b[^>]*>)([\s\S]*)(<\/svg>)/,
  '$1<path fill="#2a241b" d="M0 0h64v64H0z"/><g transform="translate(8 8) scale(.75)">$2</g>$3',
);
await writeFile(
  new URL("pwa-maskable-512x512.png", publicDir),
  new Resvg(maskable, { fitTo: { mode: "width", value: 512 } }).render().asPng(),
);
