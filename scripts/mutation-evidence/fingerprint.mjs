import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVIDENCE_SCHEMA_VERSION = 1;
const DEPENDENCY_RESOLVER_VERSION = 1;
const KNOWN_OUTPUT_DIRECTORIES = new Set([
  ".cache",
  ".next",
  ".stryker-tmp",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "reports",
]);
const fingerprintPath = fileURLToPath(import.meta.url);
const requireFromWorkspace = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const ts = requireFromWorkspace("typescript");

export function canonicalJson(value) {
  const ancestors = new WeakSet();

  function serialize(current) {
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("Canonical JSON requires finite numbers");
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError(`Canonical JSON cannot serialize ${typeof current}`);
    }
    if (ancestors.has(current)) {
      throw new TypeError("Canonical JSON cannot serialize cyclic values");
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const items = Array.from(
          { length: current.length },
          (_, index) => serialize(current[index]),
        );
        return `[${items.join(",")}]`;
      }

      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new TypeError("Canonical JSON cannot serialize symbol keys");
      }
      return `{${Object.keys(current)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(current[key])}`)
        .join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }

  return serialize(value);
}

export function sha256(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    throw new TypeError("SHA-256 input must be a string or Buffer");
  }
  return createHash("sha256").update(value).digest("hex");
}

export function createEvidenceKey(inputs) {
  const { head, base, baseRef, reportPath, jsonReportPath, ...execution } = inputs;
  return sha256(canonicalJson({ schemaVersion: EVIDENCE_SCHEMA_VERSION, ...execution }));
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function walkFiles(directory, onExcluded = () => {}, onSymlink = () => {}) {
  let directoryStat;
  try {
    directoryStat = lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (directoryStat.isSymbolicLink()) {
    onSymlink();
    return [];
  }
  if (!directoryStat.isDirectory()) return [directory];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) {
      continue;
    }
    if (KNOWN_OUTPUT_DIRECTORIES.has(entry.name)) {
      continue;
    }
    if (entry.name === "generated") {
      onExcluded();
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      onSymlink();
      continue;
    }
    if (entry.isDirectory()) files.push(...walkFiles(entryPath, onExcluded, onSymlink));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function hasSymlinkComponent(root, candidate) {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return false;
}

function parseJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function findWorkspacePackages(root) {
  const packages = [];
  for (const container of ["apps", "packages"]) {
    const containerPath = path.join(root, container);
    if (!existsSync(containerPath)) continue;
    for (const entry of readdirSync(containerPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(containerPath, entry.name);
      const manifestPath = path.join(directory, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = parseJson(manifestPath);
      packages.push({ directory, manifestPath, manifest });
    }
  }
  return packages.sort((left, right) => comparePaths(left.directory, right.directory));
}

function findOwner(root, workspacePackages, file) {
  const candidates = workspacePackages
    .filter(({ directory }) => isWithin(directory, file))
    .sort((left, right) => right.directory.length - left.directory.length);
  if (candidates.length > 0) return candidates[0];
  const rootManifest = path.join(root, "package.json");
  return existsSync(rootManifest)
    ? { directory: root, manifestPath: rootManifest, manifest: parseJson(rootManifest) }
    : null;
}

function resolveAsFile(candidate) {
  const extension = path.extname(candidate);
  const withoutExtension = extension ? candidate.slice(0, -extension.length) : candidate;
  const replacements = [
    candidate,
    ...(extension === ".js" ? [
      `${withoutExtension}.ts`,
      `${withoutExtension}.tsx`,
      `${withoutExtension}.mts`,
    ] : []),
    ...(extension === ".mjs" ? [`${withoutExtension}.mts`, `${withoutExtension}.ts`] : []),
    ...(extension === ".cjs" ? [`${withoutExtension}.cts`, `${withoutExtension}.ts`] : []),
    ...(!extension
      ? [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"].map(
          (suffix) => `${candidate}${suffix}`,
        )
      : []),
  ];
  for (const file of replacements) {
    if (existsSync(file) && statSync(file).isFile()) return path.resolve(file);
  }
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    for (const suffix of [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]) {
      const index = path.join(candidate, `index${suffix}`);
      if (existsSync(index)) return path.resolve(index);
    }
  }
  return null;
}

function packageExportTarget(exportsField, key) {
  if (typeof exportsField === "string") return key === "." ? exportsField : null;
  if (!exportsField || typeof exportsField !== "object") return null;
  const selected = exportsField[key];
  if (typeof selected === "string") return selected;
  if (selected && typeof selected === "object") {
    for (const condition of ["types", "import", "default", "node"]) {
      if (typeof selected[condition] === "string") return selected[condition];
    }
  }
  return null;
}

function resolveWorkspaceImport(specifier, workspacePackages) {
  const workspace = workspacePackages
    .filter(({ manifest }) =>
      typeof manifest.name === "string"
      && (specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)),
    )
    .sort((left, right) => right.manifest.name.length - left.manifest.name.length)[0];
  if (!workspace) return { owned: false, resolved: null };

  const subpath = specifier.slice(workspace.manifest.name.length).replace(/^\//, "");
  const exportKey = subpath ? `./${subpath}` : ".";
  const exportTarget = packageExportTarget(workspace.manifest.exports, exportKey);
  const target = exportTarget
    ?? (subpath || workspace.manifest.types || workspace.manifest.module || workspace.manifest.main)
    ?? "src/index.ts";
  return {
    owned: true,
    resolved: resolveAsFile(path.resolve(workspace.directory, target)),
  };
}

function isWorkspaceFingerprintFile(workspaceRoot, file) {
  const relative = path.relative(workspaceRoot, file).split(path.sep).join("/");
  const base = path.basename(file);
  if (
    base === ".env"
    || (base.startsWith(".env.") && !base.endsWith(".example"))
    || base === ".npmrc"
    || /\.(?:key|p12|pem|pfx|secret)$/i.test(base)
    || /\.tsbuildinfo$/i.test(base)
    || /(?:^|\.)generated\./i.test(base)
  ) {
    return false;
  }
  return relative !== "";
}

function sourceKind(file) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.(?:jsx)$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.json$/i.test(file)) return ts.ScriptKind.JSON;
  if (/\.(?:[cm]?js)$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function collectExecutionInputs({
  root,
  entryFiles,
  configurationFiles,
  migrationRoots,
  toolVersions,
  runtimeProfile,
}) {
  const absoluteRoot = path.resolve(root);
  const workspacePackages = findWorkspacePackages(absoluteRoot);
  const included = new Set();
  const expandedWorkspaces = new Set();
  const incompleteWorkspaces = new Set();
  const externalDependencyWorkspaces = new Set();
  const symlinkRuntimeInputWorkspaces = new Set();
  const compilerConfigurationCache = new Map();
  const includedCompilerConfigurations = new Set();
  const fileSystemModules = new Set(["fs", "fs/promises", "node:fs", "node:fs/promises"]);
  const defaultCompilerOptions = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
  };

  const displayPath = (file) => path.relative(absoluteRoot, file).split(path.sep).join("/");
  const markOwner = (collection, file) => {
    const owner = findOwner(absoluteRoot, workspacePackages, file);
    if (owner) collection.add(owner.directory);
  };
  const expandOwner = (file) => {
    const owner = findOwner(absoluteRoot, workspacePackages, file);
    if (!owner || expandedWorkspaces.has(owner.directory)) return;
    expandedWorkspaces.add(owner.directory);
    const markIncomplete = () => incompleteWorkspaces.add(owner.directory);
    const markSymlink = () => symlinkRuntimeInputWorkspaces.add(owner.directory);
    for (const ownedFile of walkFiles(owner.directory, markIncomplete, markSymlink)) {
      if (isWorkspaceFingerprintFile(owner.directory, ownedFile)) addFile(ownedFile);
      else markIncomplete();
    }
  };
  const includeCompilerConfigurationChain = (configPath, ownerFile) => {
    const absoluteConfigPath = path.resolve(configPath);
    if (includedCompilerConfigurations.has(absoluteConfigPath)) return;
    includedCompilerConfigurations.add(absoluteConfigPath);
    addFile(absoluteConfigPath);

    const loaded = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
    if (loaded.error) {
      throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
    }
    const extendedConfigs = Array.isArray(loaded.config.extends)
      ? loaded.config.extends
      : [loaded.config.extends];
    for (const extended of extendedConfigs) {
      if (typeof extended !== "string") continue;
      const localConfig = extended.startsWith(".") || path.isAbsolute(extended)
        ? resolveAsFile(path.resolve(path.dirname(absoluteConfigPath), extended))
        : resolveWorkspaceImport(extended, workspacePackages).resolved;
      if (localConfig && isWithin(absoluteRoot, localConfig)) {
        includeCompilerConfigurationChain(localConfig, ownerFile);
      } else {
        expandOwner(ownerFile);
      }
    }
  };
  const compilerConfigurationFor = (file) => {
    const configPath = ts.findConfigFile(path.dirname(file), ts.sys.fileExists, "tsconfig.json");
    if (!configPath || !isWithin(absoluteRoot, configPath)) {
      return { configPath: null, options: defaultCompilerOptions };
    }
    const absoluteConfigPath = path.resolve(configPath);
    if (compilerConfigurationCache.has(absoluteConfigPath)) {
      return compilerConfigurationCache.get(absoluteConfigPath);
    }

    const loaded = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
    if (loaded.error) {
      throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
    }
    const parsed = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      path.dirname(absoluteConfigPath),
      defaultCompilerOptions,
      absoluteConfigPath,
    );
    if (parsed.errors.length > 0) {
      throw new Error(
        parsed.errors
          .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
          .join("\n"),
      );
    }
    const configuration = { configPath: absoluteConfigPath, options: parsed.options };
    compilerConfigurationCache.set(absoluteConfigPath, configuration);
    includeCompilerConfigurationChain(absoluteConfigPath, file);
    return configuration;
  };
  const matchesPathAlias = (specifier, compilerOptions) =>
    Object.keys(compilerOptions.paths ?? {}).some((pattern) => {
      const wildcard = pattern.indexOf("*");
      return wildcard === -1
        ? specifier === pattern
        : specifier.startsWith(pattern.slice(0, wildcard))
          && specifier.endsWith(pattern.slice(wildcard + 1));
    });
  const resolveImport = (specifier, containingFile) => {
    if (specifier.startsWith("node:")) return { owned: false, resolved: null };
    const { options: compilerOptions } = compilerConfigurationFor(containingFile);
    const compilerResult = ts.resolveModuleName(
      specifier,
      containingFile,
      compilerOptions,
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    if (compilerResult) {
      const resolved = path.resolve(compilerResult);
      const isDependency = resolved.split(path.sep).includes("node_modules");
      const isLocal = !isDependency && isWithin(absoluteRoot, resolved);
      return {
        external: !isDependency && !isLocal,
        owned: isLocal,
        resolved: isLocal ? resolved : null,
      };
    }
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const resolved = resolveAsFile(path.resolve(path.dirname(containingFile), specifier));
      if (resolved && !isWithin(absoluteRoot, resolved)) {
        return { external: true, owned: false, resolved: null };
      }
      return { external: false, owned: true, resolved };
    }
    const workspaceResolution = resolveWorkspaceImport(specifier, workspacePackages);
    if (workspaceResolution.owned) return workspaceResolution;
    return { owned: matchesPathAlias(specifier, compilerOptions), resolved: null };
  };
  const inspectSource = (file, sourceText) => {
    const ast = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(file),
    );
    let importsFileSystem = false;
    const findFileSystemDependency = (node) => {
      if (ts.isImportDeclaration(node)
          && ts.isStringLiteralLike(node.moduleSpecifier)
          && fileSystemModules.has(node.moduleSpecifier.text)) {
        importsFileSystem = true;
      }
      if (ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "require"
          && node.arguments.length === 1
          && ts.isStringLiteralLike(node.arguments[0])
          && fileSystemModules.has(node.arguments[0].text)) {
        importsFileSystem = true;
      }
      ts.forEachChild(node, findFileSystemDependency);
    };
    findFileSystemDependency(ast);
    if (importsFileSystem) expandOwner(file);
    const visit = (node) => {
      let specifier = null;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text;
      } else if (ts.isImportEqualsDeclaration(node)
          && ts.isExternalModuleReference(node.moduleReference)
          && node.moduleReference.expression
          && ts.isStringLiteralLike(node.moduleReference.expression)) {
        specifier = node.moduleReference.expression.text;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
          expandOwner(file);
        } else {
          specifier = node.arguments[0].text;
        }
      } else if (ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "require") {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
          expandOwner(file);
        } else {
          specifier = node.arguments[0].text;
        }
      }

      if (specifier !== null) {
        const resolution = resolveImport(specifier, file);
        if (resolution.resolved) addFile(resolution.resolved);
        else if (resolution.external) markOwner(externalDependencyWorkspaces, file);
        else if (resolution.owned) expandOwner(file);
      }

      ts.forEachChild(node, visit);
    };
    visit(ast);
  };
  function addFile(candidate) {
    const file = path.resolve(candidate);
    if (!isWithin(absoluteRoot, file)) {
      throw new Error(`Execution input escapes repository root: ${candidate}`);
    }
    if (hasSymlinkComponent(absoluteRoot, file)) {
      markOwner(symlinkRuntimeInputWorkspaces, file);
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`Execution input does not exist: ${displayPath(file)}`);
    }
    if (included.has(file)) return;
    included.add(file);

    const owner = findOwner(absoluteRoot, workspacePackages, file);
    if (owner) {
      const ownerRelativeParts = path.relative(owner.directory, file).split(path.sep);
      if (ownerRelativeParts.some((part) => KNOWN_OUTPUT_DIRECTORIES.has(part))) {
        incompleteWorkspaces.add(owner.directory);
      }
    }
    if (owner && owner.manifestPath !== file) addFile(owner.manifestPath);
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      compilerConfigurationFor(file);
    }
    if (/\.(?:[cm]?[jt]sx?|json)$/.test(file)) {
      inspectSource(file, readFileSync(file, "utf8"));
    }
  }

  for (const candidate of [...entryFiles, ...configurationFiles]) {
    addFile(path.resolve(absoluteRoot, candidate));
  }
  for (const migrationRoot of migrationRoots) {
    const absoluteMigrationRoot = path.resolve(absoluteRoot, migrationRoot);
    const markSymlink = () => markOwner(symlinkRuntimeInputWorkspaces, absoluteMigrationRoot);
    for (const migration of walkFiles(absoluteMigrationRoot, () => {}, markSymlink)) addFile(migration);
  }
  addFile(path.join(absoluteRoot, "pnpm-lock.yaml"));

  const entries = [...included].map((file) => [displayPath(file), sha256(readFileSync(file))]);
  entries.push(
    [
      "@mutation-evidence/dependency-resolver.json",
      sha256(canonicalJson({ version: DEPENDENCY_RESOLVER_VERSION })),
    ],
    ["@mutation-evidence/fingerprint.mjs", sha256(readFileSync(fingerprintPath))],
    ["@runtime/profile.json", sha256(canonicalJson(runtimeProfile))],
    ["@tool/versions.json", sha256(canonicalJson(toolVersions))],
  );
  const hashes = Object.fromEntries(
    entries.sort(([left], [right]) => comparePaths(left, right)),
  );
  const reasons = [
    ...[...incompleteWorkspaces].map((workspace) => ({
      code: "excluded-runtime-inputs",
      workspace: displayPath(workspace),
    })),
    ...[...externalDependencyWorkspaces].map((workspace) => ({
      code: "external-local-dependency",
      workspace: displayPath(workspace),
    })),
    ...[...symlinkRuntimeInputWorkspaces].map((workspace) => ({
      code: "symlink-runtime-input",
      workspace: displayPath(workspace),
    })),
  ].sort((left, right) =>
    comparePaths(left.workspace, right.workspace) || comparePaths(left.code, right.code),
  );
  return { hashes, reasons, reusable: reasons.length === 0 };
}
