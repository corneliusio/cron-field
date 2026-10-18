/*
 * Targets: what a cron consumer accepts and how it runs it. A profile decides which fields the field
 * shows, which tokens it parses and writes, which presets the menus offer, how the two day fields
 * combine, and how the built-in matcher previews runs. Adapters for parser libraries build a profile
 * from the library's own options, so the profile and the engine cannot disagree.
 */
import type { FieldKey } from './fields.ts'

/** `lastDayOfWeek` is Quartz's bare `L` in the day of week: Saturday. */
export type Extension = 'last' | 'lastOffset' | 'lastWeekday' | 'nearest' | 'lastDow' | 'nth' | 'lastDayOfWeek'

/**
 * How the day of month and day of week combine when both are set.
 * - `or`: either may match, unless one of them is exactly `*` (croner, cron-parser).
 * - `vixie`: as `or`, but a field that starts with `*`, such as `*\/2`, makes both required (Vixie cron, Effect).
 * - `and`: both must match (croner with `domAndDow`).
 * - `exclusive`: only one may be set; the other stays `*` or `?` (Vercel, Quartz, EventBridge).
 */
export type DayLogic = 'or' | 'vixie' | 'and' | 'exclusive'

export type TargetProfile = {
    name: string
    label: string
    fields: FieldKey[]
    /** 1 counts Sunday as 1 and Saturday as 7, as Quartz does. */
    weekdayBase: 0 | 1
    days: DayLogic
    /** `required`: the unused day field must be `?`. `allowed`: `?` reads as `*` in the day fields. */
    question: 'none' | 'allowed' | 'required'
    names: boolean
    macros: Record<string, string>
    extensions: Extension[]
    /** Accepts a start with a step and no range, such as `5/15`. */
    stepStart: boolean
    /** `count`: a step can be as large as the field has values, 60 for minutes. `max`: no larger than the field's highest value, 59, as in Effect. */
    stepLimit: 'count' | 'max'
    /** Accepts ranges that wrap past the field's end, such as `22-2` or `FRI-MON`. */
    wrapRanges: boolean
    /** Extensions that have to be the whole field: Quartz takes no L, W or # in a list, cron-parser and EventBridge no #. */
    alone: Extension[]
    /** The years the target runs, when it has a year field. */
    years: [number, number]
    /** Shortest gap between runs, in minutes. */
    minInterval?: number
    /** The timezone the target always runs in, such as `UTC`. Omitted when the host decides. */
    timezone?: string
}

export type TargetName = 'vixie' | 'croner' | 'cron-parser' | 'effect' | 'vercel' | 'cloudflare' | 'github' | 'quartz' | 'eventbridge'

const FIVE: FieldKey[] = ['minute', 'hour', 'day', 'month', 'weekday']
const ALL_EXTENSIONS: Extension[] = ['last', 'lastWeekday', 'nearest', 'lastDow', 'nth']

/** The fields with seconds in front and a year at the end, as the target's parts allow. */
export const fieldsFor = (seconds: boolean, year = false): FieldKey[] => [...(seconds ? ['second' as const] : []), ...FIVE, ...(year ? ['year' as const] : [])]

export const STANDARD_MACROS: Record<string, string> = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
}

const base = (name: string, label: string, rest: Partial<TargetProfile> = {}): TargetProfile => ({
    name,
    label,
    fields: FIVE,
    weekdayBase: 0,
    days: 'or',
    question: 'none',
    names: true,
    macros: STANDARD_MACROS,
    extensions: [],
    stepStart: false,
    stepLimit: 'count',
    wrapRanges: false,
    alone: [],
    years: [1970, 2199],
    ...rest,
})

export const TARGETS: Record<TargetName, TargetProfile> = {
    'vixie': base('vixie', 'Cron', { days: 'vixie' }),
    'croner': base('croner', 'croner', { extensions: ALL_EXTENSIONS }),
    'cron-parser': base('cron-parser', 'cron-parser', {
        question: 'allowed',
        extensions: ['last', 'lastDow', 'nth'],
        stepStart: true,
        alone: ['nth'],
        macros: { ...STANDARD_MACROS, '@weekdays': '0 0 * * 1-5', '@weekends': '0 0 * * 0,6' },
    }),
    'effect': base('effect', 'Effect', { days: 'vixie', macros: {}, stepLimit: 'max' }),
    'vercel': base('vercel', 'Vercel', { days: 'exclusive', names: false, macros: {}, timezone: 'UTC' }),
    // Cloudflare documents L, W and # but not how the two day fields combine; this assumes either may match.
    'cloudflare': base('cloudflare', 'Cloudflare', { weekdayBase: 1, macros: {}, extensions: ALL_EXTENSIONS, timezone: 'UTC' }),
    'github': base('github', 'GitHub Actions', { days: 'vixie', macros: {}, stepStart: true, minInterval: 5, timezone: 'UTC' }),
    'quartz': base('quartz', 'Quartz', {
        fields: fieldsFor(true),
        weekdayBase: 1,
        days: 'exclusive',
        question: 'required',
        macros: {},
        extensions: [...ALL_EXTENSIONS, 'lastOffset', 'lastDayOfWeek'],
        stepStart: true,
        wrapRanges: true,
        alone: [...ALL_EXTENSIONS, 'lastOffset', 'lastDayOfWeek'],
    }),
    'eventbridge': base('eventbridge', 'EventBridge', {
        fields: fieldsFor(false, true),
        weekdayBase: 1,
        days: 'exclusive',
        question: 'required',
        macros: {},
        extensions: ['last', 'nearest', 'lastDow', 'nth'],
        stepStart: true,
        wrapRanges: true,
        alone: ['nth'],
        timezone: 'UTC',
    }),
}

export const has = (profile: TargetProfile, extension: Extension) => profile.extensions.includes(extension)
