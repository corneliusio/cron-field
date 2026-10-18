import type { OxfmtConfig } from 'oxfmt'

const config: OxfmtConfig = {
    semi: false,
    tabWidth: 4,
    printWidth: 160,
    singleQuote: true,
    arrowParens: 'avoid',
    bracketSameLine: true,
    sortPackageJson: true,
    quoteProps: 'consistent',
    sortImports: {
        newlinesBetween: false,
    },
    svelte: true,
    ignorePatterns: ['dist', 'node_modules', '.svelte-check', 'pnpm-lock.yaml'],
}

export default config
