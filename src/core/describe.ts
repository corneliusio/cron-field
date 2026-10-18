/*
 * Describing a schedule in words: one sentence for the whole schedule, the shape of each field, and
 * why a valid schedule never runs. Day fields follow the target's own rule for combining them. Every
 * phrase is a catalog message, and every value is formatted for the locale.
 */
import { formatter, type Formatter, type FormatOptions } from '../i18n/locale.ts'
import { FIELDS, sorted, type FieldKey } from './fields.ts'
import { dayLogic, everyDay, type Compiled, type Issue, type ParsedField } from './syntax.ts'

export type Shape =
    | { k: 'any'; vals: number[] }
    | { k: 'one'; v: number; vals: number[] }
    | { k: 'range' | 'wrap' | 'list'; a: number; b: number; vals: number[] }
    | { k: 'step'; step: number; a: number; b: number; full: boolean; offset: boolean; vals: number[] }

/** The most days a month can have, counting February's 29th. */
const mostDays = (month: number) => (month === 2 ? 29 : new Date(2001, month, 0).getDate())

/** The values a field covers, read as one of a few shapes the words are built from. */
export const shape = (p: ParsedField, key: FieldKey): Shape => {
    const field = FIELDS[key]
    const ranges = p.items.filter(item => item.t === 'range')
    const vals = sorted(p.set)
    const only = ranges.length === 1 && p.items.length === 1 ? ranges[0] : null
    const first = vals[0] ?? field.min
    const last = vals.at(-1) ?? field.max
    const contiguous = vals.every((v, k) => k === 0 || v === (vals[k - 1] ?? 0) + 1)

    if (vals.length === field.max - field.min + 1) {
        return { k: 'any', vals }
    }

    if (vals.length === 1) {
        return { k: 'one', v: first, vals }
    }

    if (only && only.step === 1 && contiguous) {
        return { k: 'range', a: first, b: last, vals }
    }

    if (vals.length >= 3 && first === field.min && last === field.max) {
        const gaps = vals.map((_, k) => k).filter(k => k > 0 && vals[k] !== (vals[k - 1] ?? 0) + 1)

        if (gaps.length === 1) {
            return { k: 'wrap', a: vals[gaps[0] ?? 0] ?? first, b: vals[(gaps[0] ?? 1) - 1] ?? last, vals }
        }
    }

    if (only && only.step > 1) {
        return { k: 'step', step: only.step, a: first, b: last, full: only.a === field.min && only.b >= field.max, offset: only.a !== field.min, vals }
    }

    return { k: 'list', a: first, b: last, vals }
}

const any = (): ParsedField => ({ ok: true, items: [], set: new Set(), star: true, question: false, error: null })

/** Seconds other than :00, as a lead-in to the rest of the sentence. */
const secondsPhrase = (p: ParsedField | undefined, f: Formatter): string | null => {
    if (!p || (p.set.size === 1 && p.set.has(0))) {
        return null
    }

    const s = shape(p, 'second')

    if (s.k === 'any') {
        return f.t('seconds.every', { n: 1 })
    }

    if (s.k === 'step' && s.full) {
        return f.t('seconds.every', { n: s.step })
    }

    return f.t('seconds.at', { seconds: f.list(s.vals.map(f.second)) })
}

const yearPhrase = (p: ParsedField | undefined, f: Formatter): string | null => {
    if (!p || p.star) {
        return null
    }

    const s = shape(p, 'year')

    if (s.k === 'range') {
        return f.t('range.through', { start: s.a, end: s.b })
    }

    return s.k === 'step' ? f.t('years.step', { n: s.step, start: s.a, end: s.b }) : f.list(s.vals.map(String))
}

export type DescribeOptions = FormatOptions & { timezone?: string | undefined }

/** The whole schedule as one sentence, such as "At 9:00 AM on weekdays." Null when the schedule doesn't parse. */
export const describe = (c: Compiled, options: DescribeOptions = {}): string | null => {
    if (!c.ok) {
        return null
    }

    const f = options.fmt ?? formatter(options)
    const t = f.t
    const pm = c.parsed.minute ?? any()
    const ph = c.parsed.hour ?? any()
    const pdom = c.parsed.day ?? any()
    const pmon = c.parsed.month ?? any()
    const pdow = c.parsed.weekday ?? any()
    const minutes = sorted(pm.set)
    const hours = sorted(ph.set)
    const mk = shape(pm, 'minute')
    const hk = shape(ph, 'hour')
    const domShape = shape(pdom, 'day')
    const dowShape = shape(pdow, 'weekday')
    const monthShape = shape(pmon, 'month')
    const domSpecial = pdom.items.filter(item => item.t !== 'range')
    const dowSpecial = pdow.items.filter(item => item.t !== 'range')
    const logic = dayLogic(c)
    const domAll = everyDay(pdom, 'day')
    const dowAll = everyDay(pdow, 'weekday')
    // With either-may-match, a field that covers every day makes the other one irrelevant.
    const coversAll = logic === 'or' && (domAll || dowAll)
    const domActive = !coversAll && !domAll && (logic === 'dom' || logic === 'or' || logic === 'and')
    const dowActive = !coversAll && !dowAll && (logic === 'dow' || logic === 'or' || logic === 'and')
    const monthActive = monthShape.k !== 'any'
    // Minutes that stop before the hour ends, such as 0-20/2, repeat inside each hour rather than running on into the next.
    const minutesBounded = mk.k === 'range' || (mk.k === 'step' && mk.b + mk.step <= 59)
    const span = (a: number, b: number) => ({ start: f.time(a, minutes[0] ?? 0), end: f.time(b, minutes.at(-1) ?? 0) })
    const seconds = secondsPhrase(c.parsed.second, f)
    const years = yearPhrase(c.parsed.year, f)

    let exactTimes = false
    let trailing = false
    let time: string

    /* Time of day */
    if (mk.k === 'any' && hk.k === 'any') {
        time = t('time.everyNMinutes', { n: 1 })
    } else if (minutes.length * hours.length <= 6) {
        exactTimes = true
        time = t('time.at', { times: f.list(hours.flatMap(h => minutes.map(m => f.time(h, m)))) })
    } else if (mk.k === 'one') {
        const atMinute = (base: string) => {
            if (mk.v === 0) {
                trailing = true

                return t('time.onTheHour', { base })
            }

            return t('time.atMinute', { base, minute: f.minute(mk.v) })
        }

        if (hk.k === 'any') {
            time = atMinute(t('time.everyNHours', { n: 1 }))
        } else if (hk.k === 'step') {
            time = atMinute(t('time.everyNHours', { n: hk.step }))

            if (!hk.full) {
                trailing = true
                time = t('time.between', { base: time, ...span(hk.a, hk.b) })
            }
        } else if (hk.k === 'range' || hk.k === 'wrap') {
            time = atMinute(t('time.everyNHours', { n: 1 }))
            trailing = true
            time = t('time.between', { base: time, ...span(hk.a, hk.b) })
        } else {
            exactTimes = true
            time = t('time.minutePastHours', { minute: f.minute(mk.v), hours: f.list(hours.map(f.hour)) })
        }
    } else {
        let base: string

        if (mk.k === 'any') {
            base = t('time.everyNMinutes', { n: 1 })
        } else if (mk.k === 'step') {
            base = t('time.everyNMinutes', { n: mk.step })

            if (minutes.length <= 6) {
                trailing = true
                base = t('time.minuteList', { base, minutes: f.list(minutes.map(f.minute), 'unit') })
            } else if (minutesBounded) {
                base = t('time.fromTo', { base, start: f.minute(mk.a), end: f.minute(mk.b) })
            } else if (mk.offset) {
                trailing = true
                base = t('time.starting', { base, start: f.minute(mk.a) })
            }
        } else if (mk.k === 'range') {
            base = t('time.everyMinuteFromTo', { start: f.minute(mk.a), end: f.minute(mk.b) })
        } else {
            base = t('time.at', { times: f.list(minutes.map(f.minute)) })
        }

        if (hk.k === 'any' && mk.k === 'list') {
            time = t('time.pastEveryHour', { base })
        } else if (hk.k === 'any' && minutesBounded) {
            trailing = true
            time = t('time.everyHour', { base })
        } else if (hk.k === 'one') {
            trailing = true
            time = t('time.duringHour', { base, hour: f.hour(hk.v) })
        } else if (hk.k === 'range' || hk.k === 'wrap') {
            trailing = true
            time = minutesBounded ? t('time.duringHours', { base, start: f.hour(hk.a), end: f.hour(hk.b) }) : t('time.between', { base, ...span(hk.a, hk.b) })
        } else if (hk.k === 'step') {
            trailing = true
            time = t('time.duringStep', { base, n: hk.step, nth: f.ordinal(hk.step) })

            if (!hk.full) {
                time = t('time.fromTo', { base: time, start: f.hour(hk.a), end: f.hour(hk.b) })
            }
        } else if (hk.k !== 'any') {
            trailing = true
            time = t('time.duringList', { base, hours: f.list(hours.map(f.hour)) })
        } else {
            time = base
        }
    }

    /* Days */
    const domGroups = () => {
        const s = domSpecial.length ? null : domShape
        const plain = sorted(pdom.set)
        const items: string[] = []

        if (s?.k === 'range') {
            items.push(t('dom.range', { start: f.ordinal(s.a), end: f.ordinal(s.b) }))
        } else {
            items.push(...plain.map((v, i) => (i === 0 ? t('dom.first', { day: f.ordinal(v) }) : f.ordinal(v))))
        }

        for (const item of domSpecial) {
            if (item.t === 'last') {
                items.push(item.off ? t('dom.lastOffset', { n: item.off }) : t('dom.last'))
            } else {
                items.push(item.t === 'lastWeekday' ? t('dom.lastWeekday') : t('dom.nearest', { day: f.ordinal(item.t === 'nearest' ? item.day : 0) }))
            }
        }

        return f.list(items)
    }

    const domPhrase = () => {
        const s = domSpecial.length ? null : domShape

        if (s?.k === 'step') {
            const until = !s.full && s.b + s.step <= 31

            return t('dom.step', {
                n: s.step,
                hasFrom: s.a === 1 ? 'no' : 'yes',
                from: f.ordinal(s.a),
                hasUntil: until ? 'yes' : 'no',
                until: f.ordinal(s.b),
            })
        }

        return t('dom.on', { dates: domGroups() })
    }

    const dowNames = () =>
        f.list([
            ...sorted(pdow.set).map(v => t('day.plural', { day: v, dayName: f.weekday(v) })),
            ...dowSpecial.map(item =>
                item.t === 'nth'
                    ? t('dow.nth', { k: item.k, day: item.dow, dayName: f.weekday(item.dow) })
                    : t('dow.last', { day: item.t === 'lastDow' ? item.dow : 0, dayName: f.weekday(item.t === 'lastDow' ? item.dow : 0) }),
            ),
        ])

    /** The day-of-week phrase, and whether it reads as "on …" so it can follow the time without a comma. */
    const dowPhrase = (): { text: string; on: boolean } => {
        const vals = sorted(pdow.set)
        const key = vals.join(',')

        if (!dowSpecial.length && key === '1,2,3,4,5') {
            return { text: t('dow.weekdays'), on: true }
        }

        if (!dowSpecial.length && key === '0,6') {
            return { text: t('dow.weekends'), on: true }
        }

        if (!dowSpecial.length && (dowShape.k === 'range' || dowShape.k === 'wrap') && vals.length >= 3) {
            return { text: t('range.through', { start: f.weekday(dowShape.a), end: f.weekday(dowShape.b) }), on: false }
        }

        return { text: t('dow.on', { days: dowNames() }), on: true }
    }

    const monthNames = () => {
        if (monthShape.k === 'range' || monthShape.k === 'wrap') {
            return t('range.through', { start: f.month(monthShape.a), end: f.month(monthShape.b) })
        }

        return f.list(monthShape.vals.map(m => f.month(m, monthShape.vals.length > 4 ? 'short' : 'long')))
    }

    const ofMonth = (days: string) => (monthActive ? t('days.ofMonths', { days, months: monthNames() }) : t('days.ofMonth', { days }))

    let days: string | null = null
    let join: 'comma' | 'space' = trailing ? 'comma' : 'space'

    if (domActive && dowActive && logic === 'and') {
        // Both have to match: name the weekdays, then the days of the month they must fall on.
        days = ofMonth(t('days.and', { weekdays: dowNames(), dates: domGroups() }))
    } else if (domActive && dowActive) {
        // The months apply to both day choices, so they follow the second one.
        days = monthActive
            ? t('days.orIn', { dates: domPhrase(), weekdays: dowPhrase().text, months: monthNames() })
            : t('days.or', { dates: domPhrase(), weekdays: dowPhrase().text })
    } else if (domActive) {
        days = ofMonth(domPhrase())
    } else if (dowActive) {
        const phrase = dowPhrase()

        join = phrase.on && !trailing ? 'space' : 'comma'
        days = dowSpecial.length ? ofMonth(phrase.text) : monthActive ? t('days.inMonths', { days: phrase.text, months: monthNames() }) : phrase.text
    } else if (monthActive) {
        days = exactTimes ? t('days.everyDayIn', { months: monthNames() }) : t('days.in', { months: monthNames() })
        join = !exactTimes && trailing ? 'comma' : 'space'
    } else if (exactTimes) {
        days = t('days.everyDay')
        join = 'space'
    }

    let text = days ? t('sentence.days', { time, days, join }) : time

    if (years) {
        text = t('sentence.year', { text, years })
    }

    if (options.timezone) {
        text = t('sentence.zone', { text, zone: options.timezone })
    }

    if (seconds) {
        text = t('sentence.seconds', { seconds, text })
    }

    return t('sentence.end', { text: f.cap(text) })
}

/**
 * Why a valid schedule never runs, for the common case of a day the chosen months lack. The month list and
 * ordinal are formatted for the locale; `monthNumbers` and `dayNumber` carry the raw values.
 */
export const neverReason = (c: Compiled, f: Formatter = formatter()): Issue => {
    const pdom = c.parsed.day ?? any()
    const pmon = c.parsed.month ?? any()
    const days = sorted(pdom.set)
    const months = sorted(pmon.set)
    const plain = pdom.items.every(item => item.t === 'range')
    const longest = Math.max(...months.map(mostDays))
    const first = days[0] ?? 0

    if ((c.parsed.weekday?.star ?? true) && plain && first > longest) {
        return {
            id: 'never.monthLacks',
            params: {
                months: f.list(months.map(m => f.month(m))),
                count: months.length,
                day: f.ordinal(first),
                dayNumber: first,
                monthNumbers: months.join(','),
            },
        }
    }

    return { id: 'never.generic', params: {} }
}
