import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, normalize, relative, resolve } from "node:path";

import ts from "typescript";

const sourceExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs",
]);
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const providerToken =
  /anthropic|claude|providers?[\\/]+(?:anthropic|claude)/i;

export type BoundaryTarget = {
  readonly label: string;
  readonly path: string;
  readonly expectedPresence: "present" | "future";
  readonly fileNamePattern?: RegExp;
};

export type BoundaryViolation = {
  readonly file: string;
  readonly specifier: string | null;
  readonly reason:
    | "provider_token"
    | "resolved_provider_path"
    | "unverifiable_dynamic_module"
    | "symlink";
  readonly resolvedPath?: string;
};

type ModuleReference = {
  readonly specifier: string | null;
  readonly dynamic: boolean;
};

function normalized(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

function literalText(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function moduleReferences(fileName: string, source: string): ModuleReference[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const references: ModuleReference[] = [];
  const add = (node: ts.Node | undefined, dynamic = false) => {
    references.push({ specifier: literalText(node), dynamic });
  };

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node.arguments[0], true);
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        add(node.arguments[0], true);
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "require" &&
        node.expression.name.text === "resolve"
      ) {
        add(node.arguments[0], true);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return references;
}

function compilerOptions(fileName: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(dirname(fileName), ts.sys.fileExists);
  if (!configPath) return {};
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) return {};
  return ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(configPath),
  ).options;
}

function resolvedModulePath(
  fileName: string,
  specifier: string,
): string | undefined {
  return ts.resolveModuleName(
    specifier,
    fileName,
    compilerOptions(fileName),
    ts.sys,
  ).resolvedModule?.resolvedFileName;
}

export function analyzeSourceImports(
  fileName: string,
  source: string,
): readonly BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const reference of moduleReferences(fileName, source)) {
    if (reference.specifier === null) {
      if (reference.dynamic) {
        violations.push({
          file: normalized(fileName),
          specifier: null,
          reason: "unverifiable_dynamic_module",
        });
      }
      continue;
    }
    if (providerToken.test(reference.specifier)) {
      violations.push({
        file: normalized(fileName),
        specifier: reference.specifier,
        reason: "provider_token",
      });
      continue;
    }
    const resolvedPath = resolvedModulePath(fileName, reference.specifier);
    if (resolvedPath && providerToken.test(normalized(resolvedPath))) {
      violations.push({
        file: normalized(fileName),
        specifier: reference.specifier,
        reason: "resolved_provider_path",
        resolvedPath: normalized(resolvedPath),
      });
    }
  }
  return violations;
}

export async function scanBoundaryFile(
  fileName: string,
): Promise<readonly BoundaryViolation[]> {
  const metadata = await lstat(fileName);
  if (metadata.isSymbolicLink()) {
    return [{
      file: normalized(fileName),
      specifier: null,
      reason: "symlink",
    }];
  }
  return analyzeSourceImports(fileName, await readFile(fileName, "utf8"));
}

async function filesUnder(
  path: string,
  shouldSkip: (path: string) => boolean = () => false,
): Promise<string[]> {
  if (shouldSkip(path)) return [];
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!metadata) return [];
  if (metadata.isSymbolicLink()) {
    throw new Error(`Boundary source symlink is not allowed: ${normalized(path)}`);
  }
  if (metadata.isFile()) return [path];
  const nested = await Promise.all(
    (await readdir(path, { withFileTypes: true })).map((entry) =>
      filesUnder(resolve(path, entry.name), shouldSkip),
    ),
  );
  return nested.flat();
}

export async function discoverBoundarySources(
  target: BoundaryTarget,
): Promise<string[]> {
  const files = (await filesUnder(target.path)).filter((file) =>
    sourceExtensions.has(extname(file).toLowerCase()) &&
    !testFilePattern.test(file) &&
    (!target.fileNamePattern || target.fileNamePattern.test(basename(file)))
  );
  const importBearing: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (moduleReferences(file, source).length > 0) importBearing.push(file);
  }
  return importBearing.sort((left, right) =>
    normalized(relative(target.path, left)).localeCompare(
      normalized(relative(target.path, right)),
    ),
  );
}

export async function scanRepositoryBoundary(
  repositoryRoot: string,
): Promise<BoundaryViolation[]> {
  const violations: BoundaryViolation[] = [];
  for (const root of ["apps", "packages", "scripts"]) {
    const skipGenerated = (path: string) => {
      const relativePath = normalized(relative(repositoryRoot, path));
      return relativePath.split("/").some((segment) =>
        ["node_modules", "dist", ".next"].includes(segment));
    };
    for (const file of await filesUnder(
      resolve(repositoryRoot, root),
      skipGenerated,
    )) {
      const relativeFile = normalized(relative(repositoryRoot, file));
      if (
        !sourceExtensions.has(extname(file).toLowerCase()) ||
        testFilePattern.test(file) ||
        relativeFile.includes("/node_modules/") ||
        relativeFile.includes("/dist/") ||
        relativeFile.startsWith("packages/connectors/src/providers/") ||
        relativeFile.startsWith("scripts/probes/")
      ) continue;
      if (moduleReferences(file, await readFile(file, "utf8")).length === 0) {
        continue;
      }
      violations.push(...await scanBoundaryFile(file));
    }
  }
  return violations.sort((left, right) =>
    `${left.file}:${left.specifier}`.localeCompare(
      `${right.file}:${right.specifier}`,
    ),
  );
}
