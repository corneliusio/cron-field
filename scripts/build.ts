/*
 * Builds dist: compiled modules and types, the stylesheets with base inlined into the theme, and the
 * Svelte component as source for the consumer's compiler.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { MESSAGES } from '../src/i18n/catalog.ts'
import { messageParams } from '../src/i18n/format.ts'

const root = new URL('../', import.meta.url)
const path = (p: string) => new URL(p, root)
const base = readFileSync(path('src/styles/base.css'), 'utf8')
const theme = readFileSync(path('src/styles/theme.css'), 'utf8')

rmSync(path('dist'), { recursive: true, force: true })
execFileSync('npx', ['tsc'], { cwd: root, stdio: 'inherit' })
mkdirSync(path('dist/svelte'), { recursive: true })
writeFileSync(path('dist/base.css'), base)

// One file for the theme, so a plain <link> needs no second request.
if (!theme.includes("@import './base.css';")) {
    throw new Error('theme.css no longer imports base.css as expected.')
}

writeFileSync(path('dist/theme.css'), theme.replace("@import './base.css';", base))
for (const file of ['CronField.svelte', 'index.js', 'index.d.ts']) {
    copyFileSync(path(`src/svelte/${file}`), path(`dist/svelte/${file}`))
}

// The catalog for translation tools, in FormatJS's extracted format: each id with its English and the params it takes.
const catalog = Object.fromEntries(
    Object.entries(MESSAGES).map(([id, template]) => {
        const names = messageParams(template)

        return [id, { defaultMessage: template, ...(names.length ? { description: `Params: ${names.join(', ')}` } : {}) }]
    }),
)

writeFileSync(path('dist/messages.json'), `${JSON.stringify(catalog, null, 4)}\n`)
console.log('Built dist.')
