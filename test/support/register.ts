/*
 * Loaded with `--import`: lets tests import the React wrapper (.tsx) and Svelte components. The compilers load on
 * first use, so tests that import neither pay nothing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

registerHooks({
    resolve(specifier, context, next) {
        const parent = context.parentURL ?? ''
        // Node picks Svelte's server runtime; components compiled for the client need the browser one.
        const server = specifier === 'svelte/server' || specifier.startsWith('svelte/internal/server') || parent.endsWith('?server')

        // The Svelte component imports `../index.js`, which is `index.ts` in src.
        if (parent.includes('/src/svelte/') && specifier.startsWith('.') && specifier.endsWith('.js') && !existsSync(new URL(specifier, parent))) {
            return next(new URL(specifier.replace(/\.js$/, '.ts'), parent).href, context)
        }

        if ((specifier === 'svelte' || specifier.startsWith('svelte/')) && !server) {
            return next(specifier, { ...context, conditions: ['browser', ...context.conditions] })
        }

        // Svelte's runtime takes its dev mode from this condition, and it has to match the dev compile below.
        if (specifier === 'esm-env/development') {
            return next(specifier, { ...context, conditions: ['development', ...context.conditions] })
        }

        return next(specifier, context)
    },
    load(url, context, next) {
        const [base = url] = url.split('?')

        if (!/\.(tsx|svelte)$/.test(base)) {
            return next(url, context)
        }

        const file = fileURLToPath(base)
        const source = readFileSync(file, 'utf8')

        if (base.endsWith('.tsx')) {
            const ts: typeof import('typescript') = require('typescript')
            const { outputText } = ts.transpileModule(source, {
                fileName: file,
                compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
            })

            return { format: 'module', source: outputText, shortCircuit: true }
        }

        const svelte: typeof import('svelte/compiler') = require('svelte/compiler')
        // Dev mode reports binding and ownership mistakes; `?server` asks for the server build.
        const { js } = svelte.compile(source, { filename: file, generate: url.endsWith('?server') ? 'server' : 'client', dev: true })

        return { format: 'module', source: js.code, shortCircuit: true }
    },
})
