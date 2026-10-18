/*
 * Locale formatting: what Intl can do for the field. Times, month and weekday names, lists and the first
 * day of the week come from Intl in the field's locale; ordinals and the :05 minute mark come from the
 * catalog, since Intl can't spell them. One formatter carries the translator too, so everything that builds
 * words takes a single argument.
 */
import { english, translator, type Translate, type Translator } from './translate.ts'

/** As in Intl: h12 runs 12, 1–11 AM/PM; h11 runs 0–11 AM/PM; h23 runs 00–23; h24 runs 01–24. */
export type HourCycle = 'h11' | 'h12' | 'h23' | 'h24'

export type FormatterOptions = {
    /** A BCP 47 tag such as `de` or `en-GB`. Defaults to `en`. */
    locale?: string | undefined
    /** Defaults to the locale's clock. */
    hourCycle?: HourCycle | undefined
    /** The first day of the week in the Days menu, 0 (Sunday) to 6. Defaults to the locale's when one is given, else Monday. */
    weekStart?: number | undefined
    translate?: Translate | undefined
}

/** Locale options, or a formatter the field already built from them. */
export type FormatOptions = FormatterOptions & { fmt?: Formatter | undefined }

export type Formatter = {
    locale: string
    hourCycle: HourCycle
    /** Weekdays, 0 (Sunday) to 6, in the order the week starts. */
    weekOrder: number[]
    t: Translator
    /** "9:00 AM", or "09:00" on a 24-hour clock. */
    time: (hour: number, minute: number) => string
    /** "9 AM", or a full time on a 24-hour clock, where a bare hour would read as a count. */
    hour: (hour: number) => string
    /** ":05" */
    minute: (minute: number) => string
    second: (second: number) => string
    month: (month: number, width?: 'long' | 'short') => string
    weekday: (day: number, width?: 'long' | 'short' | 'narrow') => string
    ordinal: (n: number) => string
    /** "A, B, and C"; `unit` lists without a conjunction, as in "(:00, :15, :30)". */
    list: (items: string[], type?: 'conjunction' | 'disjunction' | 'unit') => string
    /** The text with its first letter capitalized, the locale's way. */
    cap: (text: string) => string
}

/** The parts of a date or time to spell: a month and day, or an hour and minute. */
export type SpellParts = { month?: number; day?: number; hour?: number; minute?: number }

/** Spells date parts with Intl options, through some date library. The field's own default is Date; the Temporal entry passes one on Temporal. */
export type Spell = (locale: string, options: Intl.DateTimeFormatOptions, parts: SpellParts) => string

type IntlLocale = Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }

const dates = new Map<string, Intl.DateTimeFormat>()
const lists = new Map<string, Intl.ListFormat>()
const pad = (n: number) => String(n).padStart(2, '0')

const dateFormat = (locale: string, options: Intl.DateTimeFormatOptions) => {
    const key = `${locale}|${JSON.stringify(options)}`

    let format = dates.get(key)

    if (!format) {
        format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
        dates.set(key, format)
    }

    return format
}

const listFormat = (locale: string, type: Intl.ListFormatType) => {
    const key = `${locale}|${type}`

    let format = lists.get(key)

    if (!format) {
        format = new Intl.ListFormat(locale, { type, style: type === 'unit' ? 'short' : 'long' })
        lists.set(key, format)
    }

    return format
}

/** Spells through Date, in UTC so the runtime's own zone can't shift a name. */
export const spellDate: Spell = (locale, options, { month = 1, day = 1, hour = 0, minute = 0 }) =>
    dateFormat(locale, options).format(Date.UTC(2001, month - 1, day, hour, minute))

/** The locale's usual clock. */
export const localeHourCycle = (locale: string): HourCycle =>
    (dateFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle as HourCycle | undefined) ?? 'h12'

/** The locale's first day of the week, 0 (Sunday) to 6, where the runtime knows it; else Monday. */
export const localeWeekStart = (locale: string): number => {
    const intl = new Intl.Locale(locale) as IntlLocale
    const info = intl.getWeekInfo?.() ?? intl.weekInfo

    return info ? info.firstDay % 7 : 1
}

export const formatter = (options: FormatterOptions = {}, spell: Spell = spellDate): Formatter => {
    const locale = options.locale ?? 'en'
    const hourCycle = options.hourCycle ?? localeHourCycle(locale)
    const weekStart = options.weekStart ?? (options.locale ? localeWeekStart(options.locale) : 1)
    const t = options.translate ? translator(options.translate) : english
    const twentyFour = hourCycle === 'h23' || hourCycle === 'h24'
    // Some runtimes put a narrow no-break space before AM; a plain space reads the same everywhere.
    const plain = (text: string) => text.replace(/\u202f/g, ' ')
    // 24-hour clocks pad the hour, 07:30, in every locale; left to Intl, en-GB gives 7:30 and en 07:30.
    const time = (hour: number, minute: number) =>
        plain(spell(locale, { hour: twentyFour ? '2-digit' : 'numeric', minute: '2-digit', hourCycle }, { hour, minute }))

    return {
        locale,
        hourCycle,
        weekOrder: Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7),
        t,
        time,
        hour: hour => (twentyFour ? time(hour, 0) : plain(spell(locale, { hour: 'numeric', hourCycle }, { hour }))),
        minute: minute => t('format.minute', { minute: pad(minute) }),
        second: second => t('format.second', { second: pad(second) }),
        month: (month, width = 'long') => spell(locale, { month: width }, { month }),
        // 7 January 2001 was a Sunday.
        weekday: (day, width = 'long') => spell(locale, { weekday: width }, { month: 1, day: 7 + day }),
        ordinal: n => t('format.ordinal', { n }),
        list: (items, type = 'conjunction') => listFormat(locale, type).format(items),
        cap: text => `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`,
    }
}
