import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVIDENCE_SCHEMA_VERSION = 1;
const DEPENDENCY_RESOLVER_VERSION = 4;
const KNOWN_OUTPUT_DIRECTORIES = new Set([
  ".cache",
  ".next",
  ".stryker-tmp",
  ".tmp",
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
    if (entry.name === ".git") {
      continue;
    }
    if (entry.name === "node_modules") {
      onExcluded();
      const nodeModulesPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || (entry.isDirectory() && readdirSync(nodeModulesPath, { withFileTypes: true })
        .some((dependency) => dependency.isSymbolicLink()))) onSymlink();
      continue;
    }
    if (KNOWN_OUTPUT_DIRECTORIES.has(entry.name)) {
      onExcluded();
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
  staticFiles = [],
  migrationRoots,
  toolVersions,
  runtimeProfile,
  environment = process.env,
}) {
  const absoluteRoot = path.resolve(root);
  const workspacePackages = findWorkspacePackages(absoluteRoot);
  const included = new Set();
  const runtimeInspected = new Set();
  const expandedWorkspaces = new Set();
  const incompleteWorkspaces = new Set();
  const externalDependencyWorkspaces = new Set();
  const symlinkRuntimeInputWorkspaces = new Set();
  const unresolvedInstalledInputs = new Set();
  const environmentInputWorkspaces = new Set();
  const computedChildExecutionWorkspaces = new Set();
  const safeEnvironment = {};
  const installedInputs = new Map();
  const installedPackages = new Set();
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
  const installedPackageName = (specifier) => specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const installedPackageNameFromPath = (resolved) => {
    const segments = resolved.split(path.sep);
    const nodeModulesIndex = segments.lastIndexOf("node_modules");
    const first = segments[nodeModulesIndex + 1];
    return first?.startsWith("@")
      ? `${first}/${segments[nodeModulesIndex + 2]}`
      : first;
  };
  const collectInstalledPackage = (
    specifier,
    containingFile,
    ownerFile = containingFile,
    requirement = "required",
    requestedBy = null,
    resolvedRuntimeFile = null,
  ) => {
    const packageName = installedPackageName(specifier);
    if (builtinModules.includes(packageName) || packageName.startsWith("node:")) return;
    const markUnresolved = () => {
      if (requirement === "optional") {
        installedInputs.set(
          `@installed-absence/${requestedBy ?? "root"}/optional/${packageName}`,
          sha256("absent"),
        );
      } else if (findOwner(absoluteRoot, workspacePackages, ownerFile)) {
        markOwner(externalDependencyWorkspaces, ownerFile);
      } else {
        unresolvedInstalledInputs.add(packageName);
      }
    };
    let runtimeFile = resolvedRuntimeFile;
    if (!runtimeFile) try {
      runtimeFile = createRequire(containingFile).resolve(specifier);
    } catch {
      try {
        runtimeFile = createRequire(containingFile).resolve(packageName);
      } catch {
        const packageManifest = (createRequire(containingFile).resolve.paths(packageName) ?? [])
          .map((nodeModulesPath) => path.join(nodeModulesPath, packageName, "package.json"))
          .find((candidate) => existsSync(candidate));
        if (!packageManifest) {
          markUnresolved();
          return;
        }
        runtimeFile = realpathSync(packageManifest);
      }
    }
    if (!path.isAbsolute(runtimeFile)) return;
    let packageRoot = path.dirname(runtimeFile);
    while (path.dirname(packageRoot) !== packageRoot) {
      const manifestCandidate = path.join(packageRoot, "package.json");
      if (existsSync(manifestCandidate)) {
        const candidate = parseJson(manifestCandidate);
        if (candidate.name === packageName) break;
      }
      packageRoot = path.dirname(packageRoot);
    }
    const manifestPath = path.join(packageRoot, "package.json");
    if (!existsSync(manifestPath)) {
      markUnresolved();
      return;
    }
    const manifest = parseJson(manifestPath);
    const identity = `${manifest.name}@${manifest.version ?? "unknown"}`;
    if (installedPackages.has(identity)) return;
    installedPackages.add(identity);
    const logicalPackage = path.join(absoluteRoot, "node_modules", packageName);
    if (existsSync(logicalPackage) && lstatSync(logicalPackage).isSymbolicLink()
        && !isWithin(path.join(absoluteRoot, "node_modules"), realpathSync(logicalPackage))) {
      markOwner(symlinkRuntimeInputWorkspaces, ownerFile);
    }
    const installedFiles = (directory) => readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        if (entry.name === "node_modules") return [];
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          markOwner(symlinkRuntimeInputWorkspaces, ownerFile);
          return [];
        }
        if (entry.isDirectory()) return installedFiles(candidate);
        return entry.isFile() ? [candidate] : [];
      });
    for (const installedFile of installedFiles(packageRoot)) {
      installedInputs.set(
        `@installed/${identity}/${path.relative(packageRoot, installedFile).split(path.sep).join("/")}`,
        sha256(readFileSync(installedFile)),
      );
    }
    const dependencyRequireFile = path.join(packageRoot, "package.json");
    const optionalDependencies = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    for (const dependency of Object.keys(manifest.dependencies ?? {})
      .filter((name) => !optionalDependencies.has(name)).sort()) {
      collectInstalledPackage(dependency, dependencyRequireFile, ownerFile, "required", identity);
    }
    for (const dependency of [...optionalDependencies].sort()) {
      collectInstalledPackage(dependency, dependencyRequireFile, ownerFile, "optional", identity);
    }
    for (const dependency of Object.keys(manifest.peerDependencies ?? {}).sort()) {
      const peerRequirement = manifest.peerDependenciesMeta?.[dependency]?.optional === true
        ? "optional" : "required";
      collectInstalledPackage(dependency, dependencyRequireFile, ownerFile, peerRequirement, identity);
    }
  };
  const recordEnvironmentInput = (key, file) => {
    const value = environment[key];
    if (["LANG", "LC_ALL", "LC_MESSAGES", "TZ"].includes(key)
        || ["MUTATION_BASE", "MUTATION_CACHE", "MUTATION_SCOPE_DRY", "MIGRATIONS_DIR"].includes(key)) {
      const normalized = value === undefined ? "absent" : String(value);
      if (/^[A-Za-z0-9_./:@+-]{1,200}$/.test(normalized) && !normalized.includes("://")) {
        safeEnvironment[key] = normalized;
        return;
      }
    }
    const databaseHarness = runtimeProfile?.databaseHarness;
    const databaseEnvironmentHarness = ["DATABASE_ADMIN_URL", "DATABASE_URL"].includes(key)
      ? "default"
      : /^US\d+_MUTATION_DATABASE_(?:ADMIN_)?URL$/.test(key)
        ? key.replace(/_MUTATION_DATABASE_(?:ADMIN_)?URL$/, "").toLowerCase()
        : null;
    if (databaseEnvironmentHarness !== null
        && databaseEnvironmentHarness === databaseHarness
        && runtimeProfile?.databaseDriver === "postgres"
        && typeof runtimeProfile?.schemaFingerprint === "string") return;
    if (key === "DB_DRIVER" && runtimeProfile?.databaseDriver === "postgres") return;
    markOwner(environmentInputWorkspaces, file);
  };
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
      if (isWorkspaceFingerprintFile(owner.directory, ownedFile)) addFile(ownedFile, false);
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
    if (path.basename(containingFile) === "next-env.d.ts" && specifier.startsWith(".")) {
      const generatedRoot = path.resolve(path.dirname(containingFile), ".next");
      const candidate = path.resolve(path.dirname(containingFile), specifier);
      const generatedRelative = path.relative(generatedRoot, candidate);
      if (generatedRelative !== "" && isWithin(generatedRoot, candidate)) {
        return { owned: false, resolved: null };
      }
    }
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
      if (isDependency) {
        collectInstalledPackage(
          installedPackageNameFromPath(resolved),
          containingFile,
          containingFile,
          "required",
          null,
          resolved,
        );
      }
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
  const inspectSource = (file, sourceText, analyzeRuntime) => {
    const ast = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(file),
    );
    const runnerInfrastructure = displayPath(file) === "scripts/mutation-scope.mjs"
      || displayPath(file).startsWith("scripts/mutation-evidence/")
      || [
        "packages/db/scripts/verify-schema.mjs",
        "packages/db/scripts/apply-migrations.mjs",
      ].includes(displayPath(file));
    let importsFileSystem = false;
    const childProcessApis = new Set([
      "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork",
    ]);
    const childProcessBindings = new Map();
    const childProcessNamespaces = new Set();
    const workerBindings = new Set();
    const workerNamespaces = new Set();
    const findFileSystemDependency = (node) => {
      if (ts.isImportDeclaration(node)
          && ts.isStringLiteralLike(node.moduleSpecifier)
          && fileSystemModules.has(node.moduleSpecifier.text)) {
        importsFileSystem = true;
      }
      if (ts.isImportDeclaration(node)
          && ts.isStringLiteralLike(node.moduleSpecifier)
          && ["child_process", "node:child_process"].includes(node.moduleSpecifier.text)) {
        if (node.importClause?.namedBindings
            && ts.isNamespaceImport(node.importClause.namedBindings)) {
          childProcessNamespaces.add(node.importClause.namedBindings.name.text);
        }
        for (const element of node.importClause?.namedBindings?.elements ?? []) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (childProcessApis.has(importedName)) {
            childProcessBindings.set(element.name.text, importedName);
          }
        }
      }
      if (ts.isImportDeclaration(node)
          && ts.isStringLiteralLike(node.moduleSpecifier)
          && ["worker_threads", "node:worker_threads"].includes(node.moduleSpecifier.text)) {
        if (node.importClause?.namedBindings
            && ts.isNamespaceImport(node.importClause.namedBindings)) {
          workerNamespaces.add(node.importClause.namedBindings.name.text);
        }
        for (const element of node.importClause?.namedBindings?.elements ?? []) {
          if ((element.propertyName?.text ?? element.name.text) === "Worker") {
            workerBindings.add(element.name.text);
          }
        }
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
    if (importsFileSystem && !runnerInfrastructure) expandOwner(file);
    const owner = findOwner(absoluteRoot, workspacePackages, file);
    const knownMigrationRunner = /(?:const|let)\s+migrationRunner\s*=\s*resolve\s*\([^)]*["']scripts\/apply-migrations\.mjs["']/.test(sourceText);
    if (analyzeRuntime && knownMigrationRunner && owner) {
      addFile(path.join(owner.directory, "scripts/apply-migrations.mjs"));
    }
    const collectChildAliases = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer && ts.isCallExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression)
          && node.initializer.expression.text === "promisify"
          && node.initializer.arguments.length === 1
          && ts.isIdentifier(node.initializer.arguments[0])
          && childProcessBindings.has(node.initializer.arguments[0].text)) {
        childProcessBindings.set(
          node.name.text,
          childProcessBindings.get(node.initializer.arguments[0].text),
        );
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer && ts.isIdentifier(node.initializer)
          && childProcessBindings.has(node.initializer.text)) {
        childProcessBindings.set(node.name.text, childProcessBindings.get(node.initializer.text));
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer && ts.isPropertyAccessExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression)
          && childProcessNamespaces.has(node.initializer.expression.text)
          && childProcessApis.has(node.initializer.name.text)) {
        childProcessBindings.set(node.name.text, node.initializer.name.text);
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer && ts.isIdentifier(node.initializer)
          && workerBindings.has(node.initializer.text)) {
        workerBindings.add(node.name.text);
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer && ts.isPropertyAccessExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression)
          && workerNamespaces.has(node.initializer.expression.text)
          && node.initializer.name.text === "Worker") {
        workerBindings.add(node.name.text);
      }
      ts.forEachChild(node, collectChildAliases);
    };
    collectChildAliases(ast);
    if (analyzeRuntime && /require\s*\(\s*["'](?:node:)?(?:child_process|worker_threads)["']\s*\)/.test(sourceText)) {
      markOwner(computedChildExecutionWorkspaces, file);
    }
    const isDeclaredMigrationOptions = (options) => {
      if (!options) return true;
      if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 2) return false;
      const cwd = options.properties.find((property) => property.name?.getText(ast) === "cwd");
      const env = options.properties.find((property) => property.name?.getText(ast) === "env");
      if (!cwd || !ts.isPropertyAssignment(cwd) || !ts.isIdentifier(cwd.initializer)
          || cwd.initializer.text !== "packageRoot"
          || !env || !ts.isPropertyAssignment(env) || !ts.isObjectLiteralExpression(env.initializer)
          || env.initializer.properties.length !== 3) return false;
      const hasProcessEnvironment = env.initializer.properties.some((property) =>
        ts.isSpreadAssignment(property) && property.expression.getText(ast) === "process.env");
      const hasDatabaseUrl = env.initializer.properties.some((property) =>
        ts.isPropertyAssignment(property) && property.name.getText(ast) === "DATABASE_URL"
        && ts.isIdentifier(property.initializer) && property.initializer.text === "appUrl");
      const hasDatabaseAdminUrl = env.initializer.properties.some((property) =>
        ts.isPropertyAssignment(property) && property.name.getText(ast) === "DATABASE_ADMIN_URL"
        && ts.isIdentifier(property.initializer) && property.initializer.text === "ownerUrl");
      return hasProcessEnvironment && hasDatabaseUrl && hasDatabaseAdminUrl;
    };
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

      if (ts.isPropertyAccessExpression(node)) {
        const expressionText = node.expression.getText(ast);
        if (analyzeRuntime && !runnerInfrastructure
            && (expressionText === "process.env" || expressionText === "import.meta.env")) {
          recordEnvironmentInput(node.name.text, file);
        }
      }
      if (ts.isElementAccessExpression(node)
          && !runnerInfrastructure
          && analyzeRuntime
          && ["process.env", "import.meta.env"].includes(node.expression.getText(ast))) {
        if (!ts.isStringLiteralLike(node.argumentExpression)) {
          markOwner(environmentInputWorkspaces, file);
        } else {
          recordEnvironmentInput(node.argumentExpression.text, file);
        }
      }
      if (analyzeRuntime && ts.isCallExpression(node)
          && ((ts.isIdentifier(node.expression)
            && childProcessBindings.has(node.expression.text))
            || (ts.isPropertyAccessExpression(node.expression)
              && ts.isIdentifier(node.expression.expression)
              && childProcessNamespaces.has(node.expression.expression.text)
              && childProcessApis.has(node.expression.name.text)))) {
        const childProcessApi = ts.isIdentifier(node.expression)
          ? childProcessBindings.get(node.expression.text)
          : node.expression.name.text;
        const executable = node.arguments[0];
        const runsNode = executable?.getText(ast) === "process.execPath";
        const argumentsExpression = node.arguments[1];
        const declaredMigrationRunner = ["execFile", "execFileSync"].includes(childProcessApi)
          && runsNode
          && ts.isArrayLiteralExpression(argumentsExpression)
          && argumentsExpression.elements.length === 1
          && ts.isIdentifier(argumentsExpression.elements[0])
          && argumentsExpression.elements[0].text === "migrationRunner"
          && node.arguments.length <= 3
          && isDeclaredMigrationOptions(node.arguments[2])
          && knownMigrationRunner;
        if (!declaredMigrationRunner) {
          markOwner(computedChildExecutionWorkspaces, file);
        }
      }
      if (analyzeRuntime && ts.isNewExpression(node)
          && ((ts.isIdentifier(node.expression) && workerBindings.has(node.expression.text))
            || (ts.isPropertyAccessExpression(node.expression)
              && ts.isIdentifier(node.expression.expression)
              && workerNamespaces.has(node.expression.expression.text)
              && node.expression.name.text === "Worker"))) {
        markOwner(computedChildExecutionWorkspaces, file);
      }

      ts.forEachChild(node, visit);
    };
    visit(ast);
  };
  function addFile(candidate, analyzeRuntime = true) {
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
    if (included.has(file)) {
      if (analyzeRuntime && !runtimeInspected.has(file)
          && /\.(?:[cm]?[jt]sx?|json)$/.test(file)) {
        runtimeInspected.add(file);
        inspectSource(file, readFileSync(file, "utf8"), true);
      }
      return;
    }
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
      if (analyzeRuntime) runtimeInspected.add(file);
      inspectSource(file, readFileSync(file, "utf8"), analyzeRuntime);
    }
  }

  for (const candidate of [...entryFiles, ...configurationFiles]) {
    addFile(path.resolve(absoluteRoot, candidate));
  }
  for (const configurationFile of configurationFiles) {
    const absoluteConfiguration = path.resolve(absoluteRoot, configurationFile);
    if (!/^stryker(?:\.|-)|^stryker\.conf\.json$/i.test(path.basename(configurationFile))) continue;
    const contents = readFileSync(absoluteConfiguration, "utf8");
    let plugins = [];
    if (path.extname(configurationFile) === ".json") {
      const parsed = parseJson(absoluteConfiguration);
      plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
    } else {
      const pluginsMatch = contents.match(/plugins\s*:\s*\[([^\]]*)\]/s);
      plugins = [...(pluginsMatch?.[1] ?? "").matchAll(/["']([^"']+)["']/g)]
        .map((match) => match[1]);
    }
    for (const plugin of plugins) {
      if (typeof plugin !== "string" || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(plugin)) {
        unresolvedInstalledInputs.add("invalid-stryker-plugin");
      } else {
        collectInstalledPackage(plugin, absoluteConfiguration, absoluteConfiguration);
      }
    }
  }
  for (const migrationRoot of migrationRoots) {
    const absoluteMigrationRoot = path.resolve(absoluteRoot, migrationRoot);
    const markSymlink = () => markOwner(symlinkRuntimeInputWorkspaces, absoluteMigrationRoot);
    for (const migration of walkFiles(absoluteMigrationRoot, () => {}, markSymlink)) addFile(migration);
  }
  addFile(path.join(absoluteRoot, "pnpm-lock.yaml"));

  for (const tool of ["typescript", "vitest", "@stryker-mutator/core"]) {
    try {
      const toolManifest = requireFromWorkspace.resolve(`${tool}/package.json`);
      if (isWithin(absoluteRoot, toolManifest)) collectInstalledPackage(tool, toolManifest);
    } catch {
      // A tool unavailable from this fixture root is represented by toolVersions.
    }
  }

  const entries = [...included].map((file) => [displayPath(file), sha256(readFileSync(file))]);
  entries.push(...installedInputs);
  const pnpmExecutable = environment.npm_execpath;
  if (isWithin(absoluteRoot, fingerprintPath)
      && typeof pnpmExecutable === "string" && existsSync(pnpmExecutable)
      && statSync(pnpmExecutable).isFile()) {
    entries.push(["@tool/pnpm-executable", sha256(readFileSync(realpathSync(pnpmExecutable)))]);
  }
  for (const candidate of staticFiles) {
    const file = path.resolve(absoluteRoot, candidate);
    if (!isWithin(absoluteRoot, file) || hasSymlinkComponent(absoluteRoot, file)
        || !existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`Static execution input is unavailable: ${candidate}`);
    }
    entries.push([displayPath(file), sha256(readFileSync(file))]);
  }
  entries.push(
    [
      "@mutation-evidence/dependency-resolver.json",
      sha256(canonicalJson({ version: DEPENDENCY_RESOLVER_VERSION })),
    ],
    ["@mutation-evidence/fingerprint.mjs", sha256(readFileSync(fingerprintPath))],
    ["@runtime/profile.json", sha256(canonicalJson(runtimeProfile))],
    ["@tool/versions.json", sha256(canonicalJson(toolVersions))],
  );
  if (isWithin(absoluteRoot, fingerprintPath)) {
    const controlledEnvironment = Object.fromEntries([
      "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
      "LANG", "LC_ALL", "LC_MESSAGES", "TZ", "MIGRATIONS_DIR", "DB_DRIVER",
    ].filter((key) => typeof environment[key] === "string").map((key) => [key, environment[key]]));
    entries.push([
      "@runtime/child-environment.json",
      sha256(canonicalJson(controlledEnvironment)),
    ]);
  }
  if (Object.keys(safeEnvironment).length > 0) {
    entries.push(["@runtime/environment.json", sha256(canonicalJson(safeEnvironment))]);
  }
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
    ...[...environmentInputWorkspaces].map((workspace) => ({
      code: "environment-runtime-input",
      workspace: displayPath(workspace),
    })),
    ...[...computedChildExecutionWorkspaces].map((workspace) => ({
      code: "computed-child-execution-input",
      workspace: displayPath(workspace),
    })),
    ...[...unresolvedInstalledInputs].map((dependency) => ({
      code: "unresolved-installed-package",
      workspace: dependency,
    })),
  ].sort((left, right) =>
    comparePaths(left.workspace, right.workspace) || comparePaths(left.code, right.code),
  );
  return { hashes, reasons, reusable: reasons.length === 0 };
}
