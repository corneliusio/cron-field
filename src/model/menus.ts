/*
 * The chips' menus. Each menu is a list of sections, one field each: presets first, then the section's
 * own control. A preset is a cron token for its field; its label is the chip's own words for that token,
 * so a preset reads the same as the chip after you pick it. Presets the target can't read are left out.
 * Where the target reads occurrence rules, such as the second Monday, both day chips share the Days menu,
 * since those rules sit between the two fields; elsewhere each day chip has its own menu.
 */
import type { FieldKey } from '../core/fields.ts'
import {
    compress,
    dayLogic,
    dowNumber,
    format,
    offsetToken,
    parseField,
    stepToken,
    tokenize,
    type Compiled,
    type ParsedField,
    type SpecialItem,
} from '../core/syntax.ts'
import { has, type TargetProfile } from '../core/targets.ts'
import { formatter, type Formatter, type FormatOptions } from '../i18n/locale.ts'
import { english, type Translator } from '../i18n/translate.ts'
import { fieldWords } from './words.ts'

/** Preset changes, keyed by field. */
export type Changes = Partial<Record<FieldKey, string>>
/** A preset: its label and its token for the section's field. */
export type Preset = [label: string, token: string]
type Control = 'custom' | 'nth' | 'days'
export type Section = { field: FieldKey; title?: string; control: Control; holds?: (c: Compiled) => boolean; presets: Preset[] }
export type MenuKey = FieldKey | 'days'
/** A menu. The Days menu shows its presets as pills, with a dot on each heading. */
export type Menu = { key: MenuKey; title: string; sections: Section[] }

/** A preset given as a token, labeled with the chip's words, or as a token with its own label. */
export type PresetInput = string | { token: string; label: string }
/**
 * Presets per field, replacing the defaults or, as a function, built from them. Tokens are in the target's syntax.
 * Day-of-week tokens with `#` or `L` go into the Days menu's occurrence section.
 */
export type Presets = Partial<Record<FieldKey, PresetInput[] | ((defaults: string[]) => PresetInput[])>>
export type MenuOptions = FormatOptions & {
    presets?: Presets | undefined
    /** The current year, for the year presets. Defaults to the runtime's. */
    year?: number | undefined
}

/** Whether the target reads occurrence rules, which put both day fields in one menu. */
const occurrences = (profile: TargetProfile) => has(profile, 'nth') || has(profile, 'lastDow')

export const menuOf = (field: FieldKey, profile: TargetProfile): MenuKey => ((field === 'day' || field === 'weekday') && occurrences(profile) ? 'days' : field)

export const dowSet = (c: Compiled): Set<number> => {
    const p = c.parsed.weekday

    return new Set(p?.ok && !p.star ? p.set : [])
}

export const nthItem = (c: Compiled): Extract<SpecialItem, { t: 'nth' | 'lastDow' }> | null => {
    const p = c.parsed.weekday
    const item = p?.ok && p.items.length === 1 ? p.items[0] : null

    return item?.t === 'nth' || item?.t === 'lastDow' ? item : null
}

/** The occurrence options the target reads, as [value, label]: 1 to 5, then L for the last. */
export const nthOptions = (profile: TargetProfile, t: Translator = english): [string, string][] =>
    [...(has(profile, 'nth') ? ['1', '2', '3', '4', '5'] : []), ...(has(profile, 'lastDow') ? ['L'] : [])].map((k): [string, string] => [
        k,
        t('nth.option', { k }),
    ])

/** The token for an occurrence rule: `1#2` for the second Monday, `5L` for the last Friday. */
export const nthToken = (k: string, dow: number, profile: TargetProfile) => `${dowNumber(dow, profile)}${k === 'L' ? 'L' : `#${k}`}`

/** The default preset tokens for a field, in the target's syntax. Some may be ones the target can't read; those drop out later. */
const defaults = (key: FieldKey, c: Compiled, year: number): string[] => {
    const profile = c.profile
    const first = c.parsed[key]?.items[0]
    const step = first?.t === 'range' ? first.step : 1

    if (key === 'second' || key === 'minute') {
        // Start offsets only below the step, so the cadence still holds across the minute or hour.
        return [
            '*',
            ...[5, 10, 15, 30].map(n => stepToken(key, n, profile)),
            '0',
            ...[5, 10, 15, 30].filter(start => start < step).map(start => offsetToken(key, start, step, profile)),
        ]
    }

    if (key === 'hour') {
        return ['*', '9-17', stepToken('hour', 2, profile), '9']
    }

    if (key === 'month') {
        return ['*', stepToken('month', 3, profile), offsetToken('month', 2, 3, profile), offsetToken('month', 3, 3, profile)]
    }

    if (key === 'year') {
        return ['*', String(year), String(year + 1)]
    }

    if (key === 'day') {
        return ['*', '1', '1,15', 'L', 'LW', '15W']
    }

    return [
        '*',
        nthToken('1', 1, profile),
        nthToken('L', 5, profile),
        compress([1, 2, 3, 4, 5], 'weekday', profile, false),
        compress([0, 6], 'weekday', profile, false),
    ]
}

/**
 * A field's presets: the defaults or the `presets` option, the ones the target reads and `keep` allows, each labeled
 * with its own label or the chip's words.
 */
const presetsFor = (key: FieldKey, c: Compiled, year: number, f: Formatter, presets: Presets | undefined, keep?: (p: ParsedField) => boolean): Preset[] => {
    const given = presets?.[key]
    const inputs = typeof given === 'function' ? given(defaults(key, c, year)) : (given ?? defaults(key, c, year))
    const every = key === 'day' || key === 'weekday' ? f.t('preset.everyDay') : f.t('field.every', { field: key })

    return inputs.flatMap((input): Preset[] => {
        const token = typeof input === 'string' ? input : input.token
        const p = parseField(token, key, c.profile)

        if (!p.ok || !(keep?.(p) ?? true)) {
            return []
        }

        const words = fieldWords(p, key, f)

        return [[typeof input === 'string' ? (words ? f.cap(words) : every) : input.label, token]]
    })
}

/** Occurrence rules are about the month but stored in the day of week, so they get their own section between the two. */
const occurs = (p: ParsedField) => p.items.some(item => item.t === 'nth' || item.t === 'lastDow')

export const menu = (key: MenuKey, c: Compiled, options: MenuOptions = {}): Menu => {
    const profile = c.profile
    const f = options.fmt ?? formatter(options)
    const t = f.t
    const year = options.year ?? new Date().getFullYear()

    if (key !== 'days') {
        return {
            key,
            title: t('field.label', { field: key }),
            sections: [
                {
                    field: key,
                    control: key === 'weekday' ? 'days' : 'custom',
                    // Called directly on a target that reads them, the weekday menu still leaves occurrence rules to the Days menu.
                    presets: presetsFor(key, c, year, f, options.presets, key === 'weekday' && occurrences(profile) ? p => !occurs(p) : undefined),
                },
            ],
        }
    }

    return {
        key,
        title: t('menu.days'),
        sections: [
            { field: 'day', title: t('field.label', { field: 'day' }), control: 'custom', presets: presetsFor('day', c, year, f, options.presets) },
            ...(occurrences(profile)
                ? [
                      {
                          field: 'weekday' as const,
                          title: t('section.occurrence'),
                          control: 'nth' as const,
                          holds: (x: Compiled) => !!nthItem(x),
                          presets: presetsFor('weekday', c, year, f, options.presets, occurs),
                      },
                  ]
                : []),
            {
                field: 'weekday',
                title: t('field.label', { field: 'weekday' }),
                control: 'days',
                holds: x => !nthItem(x),
                presets: presetsFor('weekday', c, year, f, options.presets, p => !occurs(p)),
            },
        ],
    }
}

/** A section shows Clear while its field holds a value of the kind the section edits. */
export const sectionFilled = (section: Section, c: Compiled) => {
    const p = c.parsed[section.field]

    return !!p && (!p.ok || !p.star) && (section.holds?.(c) ?? true)
}

/** `?` and `*` both mean "any" in the day fields, so presets compare them as one. */
const same = (a: string | undefined, b: string) => (a === '?' ? '*' : a)?.toUpperCase() === (b === '?' ? '*' : b).toUpperCase()

export const isCurrent = (c: Compiled, field: FieldKey, token: string) => same(c.raws[field], token)

/** The value a field takes when the schedule has to be rebuilt from scratch: on the hour, not every minute. */
const fresh = (key: FieldKey) => (key === 'second' || key === 'minute' ? '0' : '*')

/**
 * The value with changes applied, in the target's syntax. Where the target allows only one day field,
 * setting one clears the other.
 */
export const applyChanges = (value: string, changes: Changes, profile: TargetProfile): string => {
    const parts = tokenize(value, profile)
    const whole = parts.length === profile.fields.length
    const tokens: Changes = Object.fromEntries(profile.fields.map((key, i) => [key, whole ? (parts[i] ?? fresh(key)) : fresh(key)]))

    for (const [key, token] of Object.entries(changes) as [FieldKey, string | undefined][]) {
        tokens[key] = token ?? '*'

        if (profile.days === 'exclusive' && (key === 'day' || key === 'weekday') && token && token !== '*' && token !== '?') {
            tokens[key === 'day' ? 'weekday' : 'day'] = '*'
        }
    }

    return format(tokens, profile)
}

/** No ticks means every day of the week, so unticking the last day or ticking all seven gives `*`. */
export const toggleDay = (c: Compiled, day: number): Changes => {
    const on = dowSet(c)

    if (on.has(day)) {
        on.delete(day)
    } else {
        on.add(day)
    }

    return { weekday: on.size === 0 || on.size === 7 ? '*' : compress([...on], 'weekday', c.profile, false) }
}

/** A note for the day menus on how the two day fields combine, when that matters. */
export const daysNote = (c: Compiled, t: Translator = english): string | null => {
    const logic = dayLogic(c)

    if (c.profile.days === 'exclusive') {
        return t('note.exclusive', { target: c.profile.label })
    }

    if (logic === 'or') {
        return t('note.either')
    }

    return logic === 'and' ? t('note.both') : null
}
