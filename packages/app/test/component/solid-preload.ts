// SPDX-License-Identifier: MIT
// Component-test preload: compiles .tsx with Solid's own JSX compiler (Bun's
// default JSX transform is React-shaped and cannot drive Solid), and answers
// the Vite-only import suffixes the app uses. Run with
// `--conditions=browser`, otherwise solid-js resolves to its server build,
// where effects never run and client APIs throw.
import { plugin } from "bun"
import { transformAsync } from "@babel/core"
// @ts-expect-error babel presets ship no types
import solidPreset from "babel-preset-solid"
// @ts-expect-error babel presets ship no types
import typescriptPreset from "@babel/preset-typescript"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const VITE_SUFFIX = /\?(?:[\w&=]*)(?:url|worker|raw|inline)[\w&=]*$/
// WHY: package-local, not os.tmpdir(): on the Windows runner a stub written to the
// shared %TEMP% (8.3 path RUNNER~1) was missing when terminal.tsx imported it.
const STUB_DIR = path.join(import.meta.dir, "..", "..", "node_modules", ".cache", "unifia-component-vite-stubs")
const MODULE_FILE = /\.(?:[cm]?[jt]sx?|json)$/

/**
 * Rewrites Vite's `import.meta.glob(pattern, { import })` into the object Vite
 * itself generates: one lazy loader per matching file, keyed by the path as
 * written in the pattern. Non-module assets resolve to their file URL, which
 * is what Vite's default import of an asset is.
 */
function viteGlobPlugin({ types: t, template }: typeof import("@babel/core")) {
  return {
    visitor: {
      CallExpression(nodePath: import("@babel/core").NodePath<import("@babel/types").CallExpression>, state: { filename: string }) {
        const callee = nodePath.node.callee
        const isGlob =
          t.isMemberExpression(callee) &&
          t.isMetaProperty(callee.object) &&
          t.isIdentifier(callee.property, { name: "glob" })
        if (!isGlob) return
        const [patternArg, optionsArg] = nodePath.node.arguments
        if (!t.isStringLiteral(patternArg)) throw nodePath.buildCodeFrameError("import.meta.glob needs a literal pattern")
        const importDefault =
          t.isObjectExpression(optionsArg) &&
          optionsArg.properties.some(
            (property) =>
              t.isObjectProperty(property) &&
              t.isIdentifier(property.key, { name: "import" }) &&
              t.isStringLiteral(property.value, { value: "default" }),
          )
        const directory = path.dirname(state.filename)
        const matches = [...new Bun.Glob(patternArg.value).scanSync({ cwd: directory })].sort()
        const entries = matches.map((match) => {
          const relativeKey = patternArg.value.startsWith("../") ? match.replaceAll("\\", "/") : `./${match.replaceAll("\\", "/")}`
          const absolute = path.resolve(directory, match).replaceAll("\\", "/")
          const loader = !MODULE_FILE.test(absolute)
            ? template.expression.ast(`() => Promise.resolve(${JSON.stringify(`file://${absolute}`)})`)
            : importDefault
              ? template.expression.ast(`() => import(${JSON.stringify(absolute)}).then((m) => m.default)`)
              : template.expression.ast(`() => import(${JSON.stringify(absolute)})`)
          return t.objectProperty(t.stringLiteral(relativeKey), loader)
        })
        nodePath.replaceWith(t.objectExpression(entries))
      },
    },
  }
}

plugin({
  name: "unifia-component-tests",
  setup(build) {
    // Each Vite-suffixed import resolves to a generated stub file holding its
    // default export. A custom plugin namespace would be simpler, but Bun's
    // runtime resolves those on Windows only ("Cannot find module
    // 'vite-suffix:...'" on Linux CI).
    build.onResolve({ filter: VITE_SUFFIX }, (args) => {
      const [specifier, query] = args.path.split("?")
      const resolved = specifier.startsWith(".")
        ? path.resolve(path.dirname(args.importer), specifier)
        : Bun.resolveSync(specifier, path.dirname(args.importer))
      // `?raw` is the file's text; `?url` and `?worker` are a URL the test DOM never fetches.
      const value = query.includes("raw") ? readFileSync(resolved, "utf8") : `file://${resolved.replaceAll("\\", "/")}`
      const stub = path.join(STUB_DIR, `${Bun.hash(`${resolved}?${query}`).toString(16)}.js`)
      mkdirSync(STUB_DIR, { recursive: true })
      writeFileSync(stub, `export default ${JSON.stringify(value)}\n`)
      return { path: stub }
    })
    build.onLoad({ filter: /\.tsx?$/ }, async ({ path: file }) => {
      const source = await Bun.file(file).text()
      const isTsx = file.endsWith(".tsx")
      // Plain .ts needs Babel only for Vite globs; everything else keeps Bun's own loader.
      if (!isTsx && !source.includes("import.meta.glob")) return { contents: source, loader: "ts" }
      const result = await transformAsync(source, {
        filename: file,
        plugins: [viteGlobPlugin],
        presets: [
          ...(isTsx ? [[solidPreset, { generate: "dom", hydratable: false }]] : []),
          [typescriptPreset, { onlyRemoveTypeImports: true }],
        ],
        sourceMaps: "inline",
        babelrc: false,
        configFile: false,
      })
      if (!result?.code) throw new Error(`Solid JSX compilation produced no code for ${file}`)
      return { contents: result.code, loader: "js" }
    })
  },
})
