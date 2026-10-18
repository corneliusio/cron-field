/*
 * A small ICU MessageFormat formatter for the built-in English: simple arguments, `plural` (with `=n`
 * and `#`), `selectordinal` and `select`, nested, and apostrophe quoting as ICU and FormatJS read
 * it: a single ' only starts a quote before {, } or, in a plural, #. Anything fuller belongs in the app's
 * own i18n library, through `translate`.
 */
type Part = string | { arg: string } | { pound: true } | { arg: string; kind: 'plural' | 'selectordinal' | 'select'; options: Record<string, Part[]> }

const cache = new Map<string, Part[]>()
const plurals = new Map<string, Intl.PluralRules>()

const parse = (source: string): Part[] => {
    let i = 0

    const fail = (reason: string): never => {
        throw new SyntaxError(`${reason} at ${i} in message “${source}”.`)
    }

    const space = () => {
        while (/\s/.test(source[i] ?? '')) {
            i++
        }
    }

    const word = () => {
        const start = i

        space()

        while (i < source.length && !/[\s,{}]/.test(source[i] ?? '')) {
            i++
        }

        return source.slice(start, i).trim() || fail('Expected a name')
    }

    const expect = (char: string) => {
        space()

        if (source[i] !== char) {
            fail(`Expected “${char}”`)
        }

        i++
    }

    const argument = (): Part => {
        const name = word()

        space()

        if (source[i] === '}') {
            i++

            return { arg: name }
        }

        expect(',')

        const kind = word()
        const options: Record<string, Part[]> = {}

        if (kind !== 'plural' && kind !== 'selectordinal' && kind !== 'select') {
            fail(`Unsupported argument type “${kind}”`)
        }

        expect(',')

        while (true) {
            space()

            if (source[i] === '}') {
                i++
                break
            }

            const key = word()

            // # belongs to the nearest plural only, so a select resets it.
            expect('{')
            options[key] = parts(kind !== 'select', true)
            expect('}')
        }

        if (!options.other) {
            fail(`“${name}” needs an “other” option`)
        }

        return { arg: name, kind: kind as 'plural' | 'selectordinal' | 'select', options }
    }

    const parts = (inPlural: boolean, nested: boolean): Part[] => {
        const out: Part[] = []

        let text = ''

        const flush = () => {
            if (text) {
                out.push(text)
                text = ''
            }
        }

        while (i < source.length) {
            const char = source[i] ?? ''
            const next = source[i + 1]

            if (char === "'" && next === "'") {
                text += "'"
                i += 2
            } else if (char === "'" && (next === '{' || next === '}' || (inPlural && next === '#'))) {
                // A quoted run is literal until the next lone apostrophe.
                i++

                while (i < source.length && !(source[i] === "'" && source[i + 1] !== "'")) {
                    text += source[i] === "'" ? (i++, "'") : source[i]
                    i++
                }

                i++
            } else if (char === '{') {
                flush()
                i++
                out.push(argument())
            } else if (char === '}') {
                if (!nested) {
                    fail('Unexpected “}”')
                }

                break
            } else if (char === '#' && inPlural) {
                flush()
                out.push({ pound: true })
                i++
            } else {
                text += char
                i++
            }
        }

        flush()

        return out
    }

    const result = parts(false, false)

    if (i < source.length) {
        fail('Unexpected text')
    }

    return result
}

const rules = (locale: string, type: Intl.PluralRuleType) => {
    const key = `${locale}:${type}`

    let pluralRules = plurals.get(key)

    if (!pluralRules) {
        pluralRules = new Intl.PluralRules(locale, { type })
        plurals.set(key, pluralRules)
    }

    return pluralRules
}

const render = (parts: Part[], params: Readonly<Record<string, string | number>>, locale: string, pound: number | null): string =>
    parts
        .map(part => {
            if (typeof part === 'string') {
                return part
            }

            if ('pound' in part) {
                return pound === null ? '#' : new Intl.NumberFormat(locale).format(pound)
            }

            const value = params[part.arg]

            if (!('kind' in part)) {
                return value === undefined ? `{${part.arg}}` : String(value)
            }

            // Own keys only, so a value such as `constructor` can't reach Object.prototype.
            const option = (key: string) => (Object.hasOwn(part.options, key) ? part.options[key] : undefined)

            if (part.kind === 'select') {
                return render(option(String(value)) ?? option('other') ?? [], params, locale, pound)
            }

            const n = Number(value)
            const category = rules(locale, part.kind === 'selectordinal' ? 'ordinal' : 'cardinal').select(n)

            return render(option(`=${n}`) ?? option(category) ?? option('other') ?? [], params, locale, n)
        })
        .join('')

const parsed = (template: string) => {
    let parts = cache.get(template)

    if (!parts) {
        parts = parse(template)
        cache.set(template, parts)
    }

    return parts
}

/** The arguments a template reads, with their kind: `n (plural)`, `field (select)`, or a plain name. */
export const messageParams = (template: string): string[] => {
    const found = new Map<string, string>()
    const walk = (parts: Part[]) => {
        for (const part of parts) {
            if (typeof part === 'string' || 'pound' in part) {
                continue
            }

            found.set(part.arg, 'kind' in part ? `${part.arg} (${part.kind})` : (found.get(part.arg) ?? part.arg))

            if ('kind' in part) {
                Object.values(part.options).forEach(walk)
            }
        }
    }

    walk(parsed(template))

    return [...found.values()]
}

/** Formats an ICU message. Throws a SyntaxError for a template it can't read. */
export const formatMessage = (template: string, params: Readonly<Record<string, string | number>> = {}, locale = 'en') => {
    return render(parsed(template), params, locale, null)
}
