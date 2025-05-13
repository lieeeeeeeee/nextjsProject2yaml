import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  Project, SourceFile, SyntaxKind, Node,
  ImportDeclaration, ExportDeclaration,
  FunctionDeclaration, VariableDeclaration,
  CallExpression, InterfaceDeclaration
} from "ts-morph";
import { globby } from "globby";

// ---------- 設定 --------------------------------------------------
let PROJECT_ROOT = process.cwd();
const GLOBS = ["**/*.{ts,tsx,css}", "!node_modules/**/*"];

// ---------- 型定義 ----------------------------------------------
type Entry = {
  path: string;
  type: string;
  purpose: string;
  imports: string[];
  exports: string[];
  interfaces?: string[];
  props?: string[];
  state?: string[];
  methods?: string[];
};

let projectEntries: Record<string, Entry> = {};

// ---------- ユーティリティ --------------------------------------
const toPosix = (p: string) => p.replace(/\\/g, "/");

// ---------- 解析ヘルパー (省略無しで掲載) ------------------------
function getImportEntries(sourceFile: SourceFile): string[] {
  const importMap = new Map<string, Set<string>>();
  sourceFile.getImportDeclarations().forEach((d: ImportDeclaration) => {
    const mod = d.getModuleSpecifierValue();
    const set = importMap.get(mod) ?? new Set<string>();
    importMap.set(mod, set);

    const defaultImport = d.getDefaultImport();
    if (defaultImport) set.add(defaultImport.getText());
    d.getNamedImports().forEach(n =>
      set.add(n.getAliasNode() ? `${n.getName()} as ${n.getAliasNode()!.getText()}` : n.getName())
    );
    const namespaceImport = d.getNamespaceImport();
    if (namespaceImport) set.add(`* as ${namespaceImport.getText()}`);
  });

  return [...importMap.entries()].map(([m, s]) =>
    s.size ? `${m}:{${[...s].join(",")}}` : m
  );
}

function getExportEntries(sourceFile: SourceFile): string[] {
  const out = new Set<string>();

  sourceFile.getExportDeclarations().forEach((e: ExportDeclaration) => {
    const mod = e.getModuleSpecifierValue();
    if (e.isNamespaceExport()) {
      if (mod) out.add(`* from '${mod}'`);
    } else {
      e.getNamedExports().forEach(ne => {
        const txt = ne.getAliasNode() ? `${ne.getName()} as ${ne.getAliasNode()!.getText()}` : ne.getName();
        out.add(mod ? `${txt} from '${mod}'` : txt);
      });
    }
  });

  sourceFile.getExportedDeclarations().forEach((decls, name) => {
    if (!decls.length) return;
    const k = decls[0];
    const kind =
      Node.isVariableDeclaration(k) ? "variable" :
      Node.isFunctionDeclaration(k) ? "function" :
      Node.isClassDeclaration(k)    ? "class"    :
      Node.isInterfaceDeclaration(k)? "interface":
      Node.isTypeAliasDeclaration(k)? "type"     :
      Node.isEnumDeclaration(k)     ? "enum"     : "unknown";
    out.add(`${name}:${kind}`);
  });

  return [...out];
}

function getInterfaceNames(sf: SourceFile) {
  return sf.getInterfaces().map(i => i.getName()).filter(Boolean);
}

function getReactComponentDetails(sf: SourceFile) {
  const props = new Set<string>(), state = new Set<string>(), methods = new Set<string>();

  const extractProps = (sig?: string) => {
    sig?.replace(/[{}]/g, "")
       .split(",")
       .map(p => p.trim().split(":")[0])
       .filter(Boolean)
       .forEach(p => props.add(`${p}:unknown`));
  };

  sf.forEachDescendant(node => {
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name) {
        const sig = node.getParameters().map(p => p.getText()).join(",");
        methods.add(`${name}(${sig})`);
        if (node.isExported()) extractProps(sig);
      }
    }
    if (Node.isVariableDeclaration(node)) {
      const name = node.getName();
      const init = node.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const sig = init.getText().match(/\(([^)]*?)\)/)?.[1] ?? "";
        methods.add(`${name}(${sig})`);
        node.getVariableStatement()?.isExported() && extractProps(sig);
      }
    }
    if (Node.isCallExpression(node) &&
        node.getExpression().getText().endsWith("useState")) {
      const vd = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (vd && Node.isArrayBindingPattern(vd.getNameNode())) {
        const bindingPattern = vd.getNameNode() as any; // 一時的に型アサーション
        const elements = bindingPattern.getElements ? bindingPattern.getElements() : [];
        const first = elements[0];
        if (first && Node.isBindingElement(first)) {
          const sName = first.getNameNode().getText();
          const tInfo = node.getTypeArguments()[0]?.getText() ?? "unknown";
          state.add(`${sName}:${tInfo}`);
        }
      }
    }
  });

  return { props: [...props], state: [...state], methods: [...methods] };
}

function parseTsFile(fp: string, proj: Project): Partial<Omit<Entry,"path"|"type"|"purpose">> {
  try {
    const sf = proj.getSourceFile(fp) ?? proj.addSourceFileAtPath(fp);
    sf.refreshFromFileSystemSync();

    return {
      imports:    getImportEntries(sf),
      exports:    getExportEntries(sf),
      interfaces: getInterfaceNames(sf),
      ...getReactComponentDetails(sf)
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[meta] Error parsing ${path.basename(fp)}: ${msg}`);
    return { imports: [`ERROR: ${msg}`], exports: [] };
  }
}

// ---------- 構築 & 出力 ------------------------------------------
function inferFileType(rel: string) {
  if (rel.startsWith("pages") || rel.startsWith("app")) return "page";
  if (rel.startsWith("api"))                       return "api";
  if (rel.endsWith(".css"))                       return "stylesheet";
  return "module";
}

function buildEntry(abs: string, proj: Project): Entry {
  const rel = toPosix(path.relative(PROJECT_ROOT, abs));
  const type = inferFileType(rel);
  if (type === "stylesheet") return {
    path: rel, type, purpose: "", imports: [], exports: []
  };

  const parsed = parseTsFile(abs, proj);
  return {
    path: rel,
    type,
    purpose: "",
    imports: parsed.imports || [],
    exports: parsed.exports || [],
    ...(parsed.interfaces ? { interfaces: parsed.interfaces } : {}),
    ...(parsed.props ? { props: parsed.props } : {}),
    ...(parsed.state ? { state: parsed.state } : {}),
    ...(parsed.methods ? { methods: parsed.methods } : {})
  };
}

function writeYaml(metaPath: string) {
  const sorted = Object.values(projectEntries).sort((a,b) => a.path.localeCompare(b.path));
  const doc = yaml.dump({ files: sorted }, {
    lineWidth: 140,
    sortKeys: (a,b) => a==="path"? -1 : b==="path"? 1 : a.localeCompare(b)
  });

  if (fs.existsSync(metaPath) && fs.readFileSync(metaPath,"utf8") === doc) {
    console.log("[meta] project-map.yaml is up-to-date.");
    return;
  }
  fs.writeFileSync(metaPath, doc, "utf8");
  console.log("[meta] project-map.yaml updated.");
}

async function scan() {
  projectEntries = {};
  const proj = new Project({
    tsConfigFilePath: path.join(PROJECT_ROOT,"tsconfig.json"),
    skipAddingFilesFromTsConfig: true
  });

  const paths = await globby(GLOBS, { cwd: PROJECT_ROOT, absolute: true });
  console.log(`[meta] scanning ${paths.length} files…`);
  for (const p of paths) projectEntries[toPosix(path.relative(PROJECT_ROOT,p))] = buildEntry(p,proj);

  writeYaml(path.join(PROJECT_ROOT,"project-map.yaml"));
  console.log("[meta] done.");
}

// ---------- 公開 API ---------------------------------------------
export async function generate(opts: { projectRoot?: string } = {}) {
  const cwd = process.cwd();
  if (opts.projectRoot) {
    process.chdir(opts.projectRoot);
    PROJECT_ROOT = path.resolve(opts.projectRoot);
  }
  try { await scan(); }
  finally { if (opts.projectRoot) process.chdir(cwd); }
}

// ---------- CLI 直接実行判定 --------------------------------------
if (typeof require !== "undefined" && require.main === module) {
  generate().catch(err=>{
    console.error("[meta] fatal:", err);
    process.exit(1);
  });
}