import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = resolve(exampleRoot, "../..");
const outputRoot = resolve(exampleRoot, "dist");

/** Recursively copy all JavaScript needed by browser ESM, preserving module relative paths. */
async function copyRuntimeJavaScript(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) await copyRuntimeJavaScript(sourcePath, destinationPath);
    else if (entry.isFile() && entry.name.endsWith(".js")) await copyFile(sourcePath, destinationPath);
  }
}

/** Copy only the JavaScript needed at browser runtime, without publishing declaration files or source maps. */
async function build() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(resolve(outputRoot, "vendor/online"), { recursive: true });
  await copyFile(resolve(exampleRoot, "index.html"), resolve(outputRoot, "index.html"));
  await copyFile(resolve(exampleRoot, "src/main.js"), resolve(outputRoot, "main.js"));
  await copyRuntimeJavaScript(resolve(sdkRoot, "dist"), resolve(outputRoot, "vendor/online"));
}

await build();
