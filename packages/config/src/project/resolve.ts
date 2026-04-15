import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { config as loadDotenv } from "dotenv";
import ts from "typescript";
import { kb } from "../keyboard-actions";
import { sr, srx } from "../screenreader-actions";
import { parseProjectConfigSource, type ValidatedProjectConfig } from "./schema";

export type LoadedProjectConfig = {
  path: string;
  config: ValidatedProjectConfig;
};

const loadedEnvDirs = new Set<string>();

export async function loadProjectConfig(configFile?: string): Promise<LoadedProjectConfig> {
  const resolvedPath = configFile
    ? validateExplicitConfigPath(configFile)
    : await findConfigFile();
  if (!resolvedPath) {
    throw new Error(
      "Missing rawstep.config.ts. Put rawstep.config.ts at the project root or pass --config <path>."
    );
  }

  loadEnvFileForConfig(resolvedPath);

  return {
    path: resolvedPath,
    config: parseProjectConfigSource(await loadTsConfigModule(resolvedPath), resolvedPath),
  };
}

async function findConfigFile(startDir = process.cwd()): Promise<string | undefined> {
  let currentDir = resolve(startDir);

  while (true) {
    const tsCandidate = join(currentDir, "rawstep.config.ts");
    const candidate = tsCandidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep walking upward.
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function validateExplicitConfigPath(configFile: string): string {
  const resolvedPath = resolve(configFile);
  if (!resolvedPath.endsWith(".ts")) {
    throw new Error(`Config file must be a rawstep.config.ts file. Received: ${resolvedPath}`);
  }

  return resolvedPath;
}

function loadEnvFileForConfig(configPath: string): void {
  const configDir = dirname(configPath);
  if (loadedEnvDirs.has(configDir)) {
    return;
  }

  loadDotenv({
    path: join(configDir, ".env"),
    override: false
  });
  loadedEnvDirs.add(configDir);
}

async function loadTsConfigModule(configPath: string): Promise<unknown> {
  const raw = await readFile(configPath, "utf8");
  const transpiled = ts.transpileModule(raw, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: configPath
  });

  const module = { exports: {} as Record<string, unknown> };
  const projectRequire = createRequire(pathToFileURL(configPath));
  const localRequire: NodeJS.Require = ((specifier: string) => {
    if (specifier === "@rawstep/config") {
      return {
        defineConfig<T>(config: T): T {
          return config;
        },
        kb,
        sr,
        srx
      };
    }

    return projectRequire(specifier);
  }) as NodeJS.Require;
  localRequire.resolve = projectRequire.resolve.bind(projectRequire);
  localRequire.cache = projectRequire.cache;
  localRequire.extensions = projectRequire.extensions;
  localRequire.main = projectRequire.main;
  const wrapped = new Script(
    `(function (exports, require, module, __filename, __dirname) {${transpiled.outputText}\n})`,
    { filename: configPath }
  ).runInThisContext() as (
    exports: Record<string, unknown>,
    require: NodeJS.Require,
    module: { exports: Record<string, unknown> },
    __filename: string,
    __dirname: string
  ) => void;

  wrapped(module.exports, localRequire, module, configPath, dirname(configPath));
  return module.exports.default ?? module.exports;
}
