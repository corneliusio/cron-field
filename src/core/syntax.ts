/*
 * Cron syntax: parsing with fixable errors, and writing value sets back as the shortest token. The
 * grammar is the target's: its fields, numbering, names, `?`, steps and extensions. Weekdays are
 * 0 (Sunday) to 6 internally whatever the target counts from.
 */
import type { ErrorId, WarningId } from '../i18n/catalog.ts'
import { FIELDS, type FieldKey, type FieldSpec } from './fields.ts'
import { has, type Extension, type TargetProfile } from './targets.ts'

export type RangeItem = { t: 'range'; a: number; b: number; step: number }
export type SpecialItem =
    | { t: 'last'; off: number }
    | { t: 'lastWeekday' }
    | { t: 'nearest'; day: number }
    | { t: 'lastDow'; dow: number }
    | { t: 'nth'; dow: number; k: number }
export type Item = RangeItem | SpecialItem
/** A problem as a message id and its params, so it can be shown in any language. */
export type Issue = { id: ErrorId | WarningId; params: Readonly<Record<string, string | number>> }
export type FieldIssue = Issue & { fix: string | null }
export type ParsedField = {
    ok: boolean
    items: Item[]
    set: Set<number>
    star: boolean
    question: boolean
    error: FieldIssue | null
    /** Something the target accepts but runs differently than it may read, with a fix. */
    warning?: FieldIssue
}
export type CrossIssue = Issue & { field: FieldKey; fix: Partial<Record<FieldKey, string>> | null }

export type Compiled = {
    profile: TargetProfile
    raws: Partial<Record<FieldKey, string>>
    parsed: Partial<Record<FieldKey, ParsedField>>
    /** The value is not the target's number of fields, or is a shortcut the target does not read. */
    structure: Issue | null
    /** A rule that spans fields, such as Quartz's `?` in one day field. */
    issue: CrossIssue | null
    ok: boolean
}

type Span = { min: number; max: number; parseMax: number }

/** A field's numbers as the target writes them: Quartz-style weekdays run 1 to 7. */
const span = (key: FieldKey, profile: TargetProfile): Span => {
    const field = FIELDS[key]

    if (key === 'weekday') {
        return profile.weekdayBase === 1 ? { min: 1, max: 7, parseMax: 7 } : { min: 0, max: 6, parseMax: profile.sundaySeven === 'none' ? 6 : 7 }
    }

    if (key === 'year') {
        return { min: profile.years[0], max: profile.years[1], parseMax: profile.years[1] }
    }

    return { min: field.min, max: field.max, parseMax: field.max }
}

/** A weekday as the target writes it, from the package's 0–6. */
export const dowNumber = (dow: number, profile: TargetProfile) => dow + profile.weekdayBase

const toInternal = (key: FieldKey, n: number, profile: TargetProfile) => (key === 'weekday' && profile.weekdayBase === 1 ? n - 1 : n)

const issue = (id: ErrorId | WarningId, params: Issue['params'] = {}, fix: string | null = null): FieldIssue => ({ id, params, fix })

const parseValue = (
    text: string,
    field: FieldSpec,
    profile: TargetProfile,
): { n: number; named?: boolean } | { error: Issue & { id: ErrorId }; short?: string } => {
    if (/^\d+$/.test(text)) {
        return { n: Number(text) }
    }

    if (field.names) {
        const index = field.names.indexOf(text)
        const short = text.slice(0, 3)

        if (index >= 0) {
            return { n: index + (field.nameBase ?? 0) + (field.key === 'weekday' ? profile.weekdayBase : 0), named: true }
        }

        if (text.length > 3 && field.names.includes(short)) {
            return { error: { id: 'error.threeLetters', params: { short: short.toUpperCase() } }, short }
        }
    }

    return { error: { id: 'error.unknownValue', params: { value: text.toUpperCase(), field: field.key, target: profile.label } } }
}

const unsupported = (part: string, profile: TargetProfile) => issue('error.unsupported', { target: profile.label, token: part.toUpperCase() })

/** The extension an item comes from, for targets that require some to be the whole field. */
const extensionOf = (item: Item): Extension | null => {
    if (item.t === 'range') {
        return null
    }

    return item.t === 'last' ? (item.off ? 'lastOffset' : 'last') : item.t
}

/** L, L-n, LW and W in the day of month; L and # in the day of week. Returns null for anything else. */
const parseSpecial = (part: string, key: FieldKey, alone: boolean, profile: TargetProfile): Item | FieldIssue | null => {
    const item = special(part, key, alone, profile)
    const extension = item && !('id' in item) ? (part === 'l' && key === 'weekday' ? 'lastDayOfWeek' : extensionOf(item)) : null

    return extension && !alone && profile.alone.includes(extension) ? issue('error.specialAlone', { target: profile.label, token: part.toUpperCase() }) : item
}

const special = (part: string, key: FieldKey, alone: boolean, profile: TargetProfile): Item | FieldIssue | null => {
    let match: RegExpMatchArray | null

    if (key === 'day') {
        if (part === 'l') {
            return has(profile, 'last') ? { t: 'last', off: 0 } : unsupported(part, profile)
        }

        if ((match = part.match(/^l-(\d+)$/))) {
            const off = Number(match[1])

            if (!has(profile, 'lastOffset')) {
                return issue('error.lastOffsetUnsupported', { token: part.toUpperCase() })
            }

            return off >= 1 && off <= 30 ? { t: 'last', off } : issue('error.lastOffsetRange')
        }

        if (part === 'lw' || part === 'wl') {
            if (!has(profile, 'lastWeekday')) {
                return unsupported(part, profile)
            }

            return alone && part === 'lw' ? { t: 'lastWeekday' } : issue('error.lwWhole', {}, 'LW')
        }

        if ((match = part.match(/^(\d+)w$/))) {
            const day = Number(match[1])

            if (!has(profile, 'nearest')) {
                return unsupported(part, profile)
            }

            return day >= 1 && day <= 31 ? { t: 'nearest', day } : issue('error.nearestRange')
        }
    }

    if (key === 'weekday') {
        const friday = dowNumber(5, profile)

        // In Quartz and EventBridge, L on its own is the last day of the week: Saturday.
        if (part === 'l') {
            return has(profile, 'lastDayOfWeek')
                ? { t: 'range', a: 6, b: 6, step: 1 }
                : issue('error.dowLNeedsDay', { example: `${friday}L` }, has(profile, 'lastDow') ? `${friday}L` : null)
        }

        if ((match = part.match(/^([a-z]{3}|\d)(l|#l|#(\d+))$/))) {
            const value = parseValue(match[1] ?? '', FIELDS.weekday, profile)
            const { min, parseMax } = span('weekday', profile)
            const k = Number(match[3])
            const nth = match[3] !== undefined

            if ('error' in value || value.n < min || value.n > parseMax || (value.named && !profile.names)) {
                return issue('error.notWeekday', { value: match[1] ?? '', min, max: span('weekday', profile).max, names: profile.names ? 'yes' : 'no' })
            }

            if (!has(profile, nth ? 'nth' : 'lastDow') || (match[2] === '#l' && profile.name !== 'croner')) {
                return unsupported(part, profile)
            }

            const dow = toInternal('weekday', value.n, profile) % 7

            if (!nth) {
                return { t: 'lastDow', dow }
            }

            return k >= 1 && k <= 5 ? { t: 'nth', dow, k } : issue('error.nthRange', { example: `${dowNumber(1, profile)}#2` })
        }
    }

    return null
}

/** A backwards range split at the end of the field, its step carried on across the wrap: 22-2/2 becomes 22,0-2/2. */
const splitWrap = (a: number, b: number, step: number, { min, max }: Span) => {
    const last = a + Math.floor((max - a) / step) * step
    const resume = last + step - (max - min + 1)
    const range = (from: number, to: number) => (from === to ? `${from}` : `${from}-${to}${step > 1 ? `/${step}` : ''}`)

    return [range(a, last === a ? a : max), ...(resume <= b ? [range(resume, b)] : [])].join(',')
}

export const parseField = (raw: string, key: FieldKey, profile: TargetProfile): ParsedField => {
    const field = FIELDS[key]
    const bounds = span(key, profile)
    const text = raw.trim().toLowerCase()
    const parts = text.split(',')
    const dayField = key === 'day' || key === 'weekday'
    const result: ParsedField = { ok: false, items: [], set: new Set(), star: text === '*', question: text === '?', error: null }
    const fail = (id: ErrorId, params: Issue['params'] = {}, fix: string | null = null) => {
        result.error = issue(id, params, fix)

        return result
    }
    const swap = (part: string, next: string) => parts.map(p => (p === part ? next : p)).join(',')

    if (!text) {
        return fail('error.empty', { field: key }, '*')
    }

    if (text === '?') {
        if (!dayField) {
            return fail('error.questionDays', {}, '*')
        }

        if (profile.question === 'none') {
            return fail('error.questionStar', {}, '*')
        }

        // Every day either way; where ? counts as set, it isn't the * that leaves the other day field to decide.
        result.star = profile.question !== 'value'
        result.items.push({ t: 'range', a: field.min, b: field.max, step: 1 })
    }

    for (const part of result.question ? [] : parts) {
        const special = part ? parseSpecial(part, key, parts.length === 1, profile) : null
        const match = part.match(/^(\*|[a-z0-9]+)(?:-([a-z0-9]+))?(?:\/(\d+))?$/)
        const hasStep = match?.[3] !== undefined
        const step = hasStep ? Number(match?.[3]) : 1

        let a = bounds.min
        let b = bounds.max

        if (!part) {
            return fail('error.extraComma', {}, parts.filter(Boolean).join(',').toUpperCase())
        }

        if (special && 'id' in special) {
            result.error = special

            return result
        }

        if (special) {
            // Specials repeat when they mean the same, as 5L and FRIL do.
            if (profile.unique && result.items.some(item => JSON.stringify(item) === JSON.stringify(special))) {
                return fail('error.duplicate', { value: part.toUpperCase(), target: profile.label })
            }

            result.items.push(special)
            continue
        }

        if (!match) {
            return fail('error.invalidPart', { part, field: key })
        }

        const stepMax = profile.stepLimit === 'max' ? bounds.parseMax : bounds.max - bounds.min + 1
        const longStep = hasStep && step > stepMax

        if (hasStep && (step < 1 || (longStep && !profile.longSteps))) {
            return fail('error.stepRange', { max: stepMax })
        }

        if (match[1] === '*' && match[2] !== undefined) {
            return fail('error.starRange', { part })
        }

        if (match[1] === '*' && hasStep && key === 'year' && !profile.yearStarStep) {
            const range = `${bounds.min}-${bounds.max}/${step}`

            return fail('error.stepNeedsRange', { part, example: range }, swap(part, range).toUpperCase())
        }

        // W names one day, so it can't end a range or take a step, as in 1-5W.
        if (key === 'day' && [match[1], match[2]].some(value => value && /^\d+w$/.test(value))) {
            result.error = has(profile, 'nearest') ? issue('error.nearestAlone') : unsupported('w', profile)

            return result
        }

        if (match[1] !== '*') {
            const start = parseValue(match[1] ?? '', field, profile)
            const end = match[2] === undefined ? null : parseValue(match[2], field, profile)

            if ('error' in start) {
                return fail(start.error.id, start.error.params, start.short ? text.replace(match[1] ?? '', start.short).toUpperCase() : null)
            }

            if (end && 'error' in end) {
                return fail(end.error.id, end.error.params, end.short ? text.replace(match[2] ?? '', end.short).toUpperCase() : null)
            }

            if (!profile.names && (start.named || end?.named)) {
                const numbers = text.replace(/[a-z]{3}/g, name => {
                    const value = parseValue(name, field, profile)

                    return 'n' in value ? String(value.n) : name
                })

                return fail('error.noNames', { target: profile.label }, numbers.toUpperCase())
            }

            a = start.n
            b = end ? end.n : a

            for (const value of [a, b]) {
                if (value < bounds.min || value > bounds.parseMax) {
                    return fail('error.outOfRange', { value, field: key, min: bounds.min, max: bounds.max })
                }
            }

            if (hasStep && !end) {
                // A step from a start runs to the field's end; in the day of week, to 7 where a step reaches Sunday as 7, so 7/2 is Sunday alone.
                const last = key === 'weekday' && profile.sundaySeven === 'steps' ? bounds.parseMax : bounds.max
                const range = `${a}-${Math.max(last, a)}/${step}`

                if (!profile.stepStart || a > last) {
                    return fail('error.stepNeedsRange', { part, example: range }, swap(part, range).toUpperCase())
                }

                b = last
            }

            if (key === 'weekday' && profile.weekdayBase === 0 && profile.sundaySeven !== 'none' && b === 0 && a > 0) {
                return fail('error.sundaySeven', {}, swap(part, `${a}-7${hasStep ? `/${step}` : ''}`).toUpperCase())
            }

            if (a > b && !profile.wrapRanges) {
                return fail('error.backwards', { range: `${a}-${b}` }, swap(part, splitWrap(a, b, step, bounds)).toUpperCase())
            }

            // A range past the field's end runs to the end, then on from the start, its step carried across the wrap.
            if (a > b) {
                const last = a + Math.floor((bounds.max - a) / step) * step
                const resume = last + step - (bounds.max - bounds.min + 1)

                result.items.push({ t: 'range', a: toInternal(key, a, profile), b: toInternal(key, bounds.max, profile), step })

                if (resume <= b) {
                    result.items.push({ t: 'range', a: toInternal(key, resume, profile), b: toInternal(key, b, profile), step })
                }

                continue
            }
        }

        if (longStep) {
            result.warning ??= issue('warning.longStep', { step, target: profile.label, start: a }, swap(part, String(a)).toUpperCase())
        }

        result.items.push({ t: 'range', a: toInternal(key, a, profile), b: toInternal(key, b, profile), step })
    }

    for (const item of result.items) {
        if (item.t !== 'range') {
            continue
        }

        // Sunday can come twice inside one range, as in 0-7, so only values from earlier parts count as repeats.
        const earlier = new Set(result.set)

        for (let value = item.a; value <= item.b; value += item.step) {
            const v = key === 'weekday' ? value % 7 : value

            if (profile.unique && earlier.has(v)) {
                return fail('error.duplicate', { value: key === 'weekday' ? dowNumber(value, profile) : value, target: profile.label })
            }

            result.set.add(v)
        }
    }

    // The fix lists the values the step gives, unless L or # comes with them.
    if (profile.noSteps.includes(key) && text.includes('/')) {
        const plain = result.items.every(item => item.t === 'range')

        return fail('error.unsupported', { target: profile.label, token: '/' }, plain ? compress([...result.set], key, profile, false) : null)
    }

    result.ok = true

    return result
}

/** A shortcut such as `@daily`, or null. Shortcuts are written in five fields; a seconds field gets `0` and a year field `*`. */
export const expand = (input: string, profile: TargetProfile): string[] | null => {
    const key = profile.caseSensitiveMacros ? input.trim() : input.trim().toLowerCase()
    // Own keys only, so input such as `constructor` cannot reach Object.prototype.
    const tokens = Object.hasOwn(profile.macros, key) ? profile.macros[key]?.split(' ') : undefined

    return tokens ? [...(profile.fields[0] === 'second' ? ['0'] : []), ...tokens, ...(profile.fields.at(-1) === 'year' ? ['*'] : [])] : null
}

/** Splits a value into the target's fields, expanding a shortcut the target reads. */
export const tokenize = (value: string, profile: TargetProfile): string[] => {
    const text = value.trim()

    return text ? (expand(text, profile) ?? text.split(/\s+/)) : []
}

/** A sample schedule in the target's own fields, for hints. */
export const sample = (profile: TargetProfile) =>
    format({ second: '0', minute: '0', hour: '9', day: '*', month: '*', weekday: `${dowNumber(1, profile)}-${dowNumber(5, profile)}`, year: '*' }, profile)

const structureError = (value: string, tokens: string[], profile: TargetProfile): Issue | null => {
    const text = value.trim()
    const count = profile.fields.length

    if (!text) {
        return { id: 'error.typeSchedule', params: { example: sample(profile) } }
    }

    // One token means the target didn't expand it. An @word with more after it is a field-count problem instead.
    if (tokens.length === 1 && text.startsWith('@')) {
        return Object.keys(profile.macros).length
            ? { id: 'error.unknownShortcut', params: { token: tokens[0] ?? '' } }
            : { id: 'error.noShortcuts', params: { target: profile.label, token: tokens[0] ?? '' } }
    }

    return tokens.length === count ? null : { id: 'error.fieldCount', params: { target: profile.label, count, actual: tokens.length } }
}

/** Rules across the two day fields: one of them only, and `?` where the target requires it. */
const crossIssue = (parsed: Compiled['parsed'], profile: TargetProfile): CrossIssue | null => {
    const dom = parsed.day
    const dow = parsed.weekday

    if (!dom?.ok || !dow?.ok) {
        return null
    }

    if (profile.days === 'exclusive' && !dom.star && !dow.star) {
        return { id: 'error.bothDays', params: { target: profile.label, token: profile.question === 'required' ? '?' : '*' }, field: 'day', fix: { day: '*' } }
    }

    if (profile.question !== 'required') {
        return null
    }

    if (dom.question && dow.question) {
        return { id: 'error.bothQuestion', params: {}, field: 'day', fix: { day: '*' } }
    }

    if (!dom.question && !dow.question) {
        return {
            id: 'error.needsQuestion',
            params: { target: profile.label },
            field: dow.star ? 'weekday' : 'day',
            fix: dow.star ? { weekday: '?' } : { day: '?' },
        }
    }

    return null
}

export const compile = (value: string, profile: TargetProfile): Compiled => {
    const tokens = tokenize(value, profile)
    const structure = structureError(value, tokens, profile)
    const raws: Compiled['raws'] = {}
    const parsed: Compiled['parsed'] = {}

    profile.fields.forEach((key, i) => {
        const raw = tokens[i]

        if (raw !== undefined) {
            raws[key] = raw
            parsed[key] = parseField(raw, key, profile)
        }
    })

    const issue = crossIssue(parsed, profile)
    const fieldsOk = profile.fields.every(key => parsed[key]?.ok)

    return {
        profile,
        raws,
        parsed,
        structure,
        issue,
        ok: !structure && !issue && fieldsOk,
    }
}

/**
 * Joins field tokens in the target's order. Targets that require `?` get it in the day field that is
 * not in use, so the menus can write `*` everywhere.
 */
export const format = (tokens: Partial<Record<FieldKey, string>>, profile: TargetProfile): string => {
    const next = { ...tokens }

    if (profile.question === 'required') {
        const domFree = !next.day || next.day === '*' || next.day === '?'
        const dowFree = !next.weekday || next.weekday === '*' || next.weekday === '?'

        if (dowFree) {
            next.weekday = '?'
            next.day = domFree ? '*' : (next.day ?? '*')
        } else if (domFree) {
            next.day = '?'
        }
    }

    return profile.fields.map(key => next[key] || '*').join(' ')
}

/**
 * A restricted day field whose values match every day, whatever special items such as L come with them. It reads as
 * unrestricted, and OR-combining targets run every day whatever the other field says.
 */
export const everyDay = (p: ParsedField, key: 'day' | 'weekday') => p.ok && !p.star && p.set.size === (key === 'day' ? 31 : 7)

/**
 * Which day rule the target applies: neither field, one of them, or both combined. Vixie cron and Effect
 * require both when either field starts with `*`, so `*\/2` with a weekday means odd days that are that weekday.
 */
export const dayLogic = (c: Compiled): 'any' | 'dom' | 'dow' | 'or' | 'and' => {
    const dom = c.parsed.day
    const dow = c.parsed.weekday
    const days = c.profile.days

    if (!dom?.ok || !dow?.ok || (dom.star && dow.star)) {
        return 'any'
    }

    if (dom.star || dow.star) {
        return dom.star ? 'dow' : 'dom'
    }

    const starred = days === 'vixie' && [c.raws.day, c.raws.weekday].some(raw => raw?.startsWith('*'))

    return days === 'and' || days === 'exclusive' || starred ? 'and' : 'or'
}

/* ---------- Writing a set of values back as the shortest token ---------- */

/** A step from the field's start, as the target writes it: `*\/5`, or `0/5` where a start with a step is the norm. */
export const stepToken = (key: FieldKey, step: number, profile: TargetProfile) => (profile.stepStart ? `${span(key, profile).min}/${step}` : `*/${step}`)

/** A step from a later start, running to the field's end. */
export const offsetToken = (key: FieldKey, start: number, step: number, profile: TargetProfile) =>
    profile.stepStart ? `${start}/${step}` : `${start}-${span(key, profile).max}/${step}`

/** Lists and ranges, or a step when the values are evenly spaced and `steps` allows it. Values are the package's own, weekdays 0–6. */
export const compress = (values: number[], key: FieldKey, profile: TargetProfile, steps = true): string => {
    const { min, max } = span(key, profile)
    const vals = [...new Set(values.map(v => (key === 'weekday' ? dowNumber(v, profile) : v)))].sort((a, b) => a - b)
    const n = vals.length
    const parts: string[] = []
    const first = vals[0] ?? min
    const last = vals[n - 1] ?? max
    const gap = (vals[1] ?? first) - first

    let i = 0

    if (!n) {
        return ''
    }

    if (n === max - min + 1) {
        return '*'
    }

    if (steps && n >= 3 && gap > 1 && vals.every((v, k) => k === 0 || v - (vals[k - 1] ?? v) === gap)) {
        if (last + gap <= max) {
            return `${first}-${last}/${gap}`
        }

        return first === min ? stepToken(key, gap, profile) : offsetToken(key, first, gap, profile)
    }

    while (i < n) {
        let j = i

        while (j + 1 < n && vals[j + 1] === (vals[j] ?? 0) + 1) {
            j++
        }

        if (j - i >= 2) {
            parts.push(`${vals[i]}-${vals[j]}`)
        } else {
            parts.push(...vals.slice(i, j + 1).map(String))
        }

        i = j + 1
    }

    return parts.join(',')
}
