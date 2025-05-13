import chokidar from "chokidar";
import path from "path";
import { generate } from "./generateMap.js";

type WatchOpts = { dir?: string | string[] };

const IGNORED = [
  /(^|[\/\\])\../,
  "node_modules/**",".next/**",
  "*.log","*.yaml","dist/**","coverage/**"
];

export function watch(opts: WatchOpts = {}) {
  const root = process.cwd();
  const dir  = opts.dir ?? path.join(root,"src");

  console.log(`[watch] dir=${Array.isArray(dir)?dir.join(","):dir}`);

  const watcher = chokidar.watch(dir,{ ignored: IGNORED, ignoreInitial: true });

  const run = (ev:string, fp:string) => {
    console.log(`[watch] ${ev}: ${fp}`);
    generate().catch(e=>console.error("[watch] error:",e));
  };

  watcher
    .on("add",    f=>run("add",    path.relative(root,f)))
    .on("change", f=>run("change", path.relative(root,f)))
    .on("unlink", f=>run("unlink", path.relative(root,f)))
    .on("ready",  ()=>console.log("[watch] ready (Ctrl+C to quit)"))
    .on("error",  err=>console.error("[watch] fs-error:",err));

  const bye = () => watcher.close().then(()=>process.exit(0));
  process.on("SIGINT",bye).on("SIGTERM",bye);
}

if (typeof require !== "undefined" && require.main === module) {
  const idx = process.argv.findIndex(a=>["-d","--dir"].includes(a));
  watch({ dir: idx>=0 ? process.argv[idx+1] : undefined });
}