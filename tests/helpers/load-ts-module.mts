import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

/** Load the actual route/service with external I/O mocked, rather than copying its logic. */
export function loadTsModule(relativePath: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
    const filename = path.resolve(relativePath);
    const require = createRequire(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const loadedModule = { exports: {} as Record<string, unknown> };
    vm.runInNewContext(code, {
        module: loadedModule, exports: loadedModule.exports,
        require: (name: string) => name in mocks ? mocks[name] : require(name),
        process, Buffer, console, URL, URLSearchParams, Headers, Request, Response, File, FormData,
        AbortSignal, setTimeout, clearTimeout, ReadableStream, Uint8Array, ...globals,
    }, { filename });
    return loadedModule.exports;
}
