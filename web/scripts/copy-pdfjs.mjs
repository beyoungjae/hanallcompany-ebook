import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const srcDir = path.join(
  root,
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
);
const outDir = path.join(root, "public", "pdfjs");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(filename) {
  const from = path.join(srcDir, filename);
  const to = path.join(outDir, filename);
  fs.copyFileSync(from, to);
  return { from, to };
}

try {
  ensureDir(outDir);

  const copied = [
    copyFile("pdf.mjs"),
    copyFile("pdf.worker.min.mjs"),
  ];

  // eslint-disable-next-line no-console
  console.log("[postinstall] Copied pdfjs assets:", copied.map((c) => path.relative(root, c.to)).join(", "));
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn("[postinstall] Failed to copy pdfjs assets. PDF viewer may not work.", e);
}


