import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import { bumpVersion, copyHtml, root, uiOptions } from "./ui-build.mjs";

const build = await bumpVersion();
await rm(resolve(root, "dist"), { recursive: true, force: true });
const started = performance.now();
await esbuild.build(uiOptions(build));
await copyHtml();
console.log(`Build v${build.version} pronto em ${Math.round(performance.now() - started)} ms`);
