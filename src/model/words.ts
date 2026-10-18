/*
 * Words for the chips: each label says what its field means on its own. Restricted day fields also
 * say how they combine, by the target's rule. Every phrase is a lowercase catalog message, and each
 * finished label is capitalized once, so a label reads the same alone or after another.
 */
import { shape, type Shape } from '../core/describe.ts'
import { FIELDS, type FieldKey } from '../core/fields.ts'
import { dayLogic, type Compiled, type ParsedField, type SpecialItem } from '../core/syntax.ts'
import { formatter, type Formatter, type FormatOptions } from '../i18n/locale.ts'

/** A step reads as a cadence only when it carries on evenly into the next minute, hour, day, month or year. Otherwise its bounds matter. */
const even = (s: Extract<Shape, { k: 'step' }>, key: FieldKey) => {
    const field = FIELDS[key]

    return s.a - field.min < s.step && s.b + s.step > field.max
}

const timeLabel = (key: 'second' | 'minute' | 'hour', f: Formatter) => (key === 'hour' ? f.hour : key === 'second' ? f.second : f.minute)

const timeText = (s: Shape, key: 'second' | 'minute' | 'hour', f: Formatter) => {
    const label = timeLabel(key, f)

    return s.k === 'range' ? f.t('word.timeRange', { start: label(s.a), end: label(s.b) }) : f.list(s.vals.map(label))
}

const extText = (item: SpecialItem, f: Formatter) => {
    if (item.t === 'last') {
        return item.off ? f.t('word.lastOffset', { n: item.off, nth: f.ordinal(item.off + 1) }) : f.t('word.lastDay')
    }

    if (item.t === 'lastWeekday') {
        return f.t('word.lastWeekday')
    }

    if (item.t === 'nearest') {
        return f.t('word.nearest', { day: f.ordinal(item.day) })
    }

    return item.t === 'lastDow'
        ? f.t('word.lastDow', { day: item.dow, dayName: f.weekday(item.dow) })
        : f.t('word.nth', { k: item.k, day: item.dow, dayName: f.weekday(item.dow) })
}

const domText = (s: Shape, bounded: boolean, f: Formatter) => {
    if (s.k === 'step' && bounded) {
        return f.t('word.domStepBounded', { n: s.step, start: f.ordinal(s.a), end: f.ordinal(s.b) })
    }

    if (s.k === 'step') {
        return s.step === 2
            ? f.t('word.domParity', { parity: s.a === 1 ? 'odd' : 'even' })
            : f.t('word.domStep', { n: s.step, hasFrom: s.a > 1 ? 'yes' : 'no', from: f.ordinal(s.a) })
    }

    return s.k === 'range'
        ? f.t('word.domRange', { start: f.ordinal(s.a), end: f.ordinal(s.b) })
        : f.t('word.domList', { dates: f.list(s.vals.map(f.ordinal)) })
}

const dowText = (s: Shape, f: Formatter) => {
    const key = s.vals.join(',')

    if (key === '1,2,3,4,5') {
        return f.t('word.weekdays')
    }

    // Three or more days in a row read as a range, as in the sentence, so FRI-MON is Friday through Monday rather than in week order.
    if ((s.k === 'range' || s.k === 'wrap') && s.vals.length >= 3) {
        return f.t('range.through', { start: f.weekday(s.a), end: f.weekday(s.b) })
    }

    return key === '0,6' ? f.t('word.weekends') : f.list(s.vals.map(v => f.t('day.plural', { day: v, dayName: f.weekday(v) })))
}

const monthText = (s: Shape, bounded: boolean, f: Formatter) => {
    if (s.k === 'step' && !bounded) {
        return f.t('word.quarterly', { n: s.step, month: f.month(s.a, 'short') })
    }

    return s.k === 'range'
        ? f.t('word.monthRange', { start: f.month(s.a, 'short'), end: f.month(s.b, 'short') })
        : f.t('word.monthList', { months: f.list(s.vals.map(v => f.month(v, 'short'))) })
}

const cadenceText = (s: Shape, key: 'second' | 'minute' | 'hour', bounded: boolean, f: Formatter) => {
    const label = timeLabel(key, f)

    if (s.k !== 'step') {
        return key === 'hour' && s.k === 'range' ? timeText(s, key, f) : f.t('time.at', { times: timeText(s, key, f) })
    }

    const every = f.t(key === 'second' ? 'seconds.every' : key === 'minute' ? 'time.everyNMinutes' : 'time.everyNHours', { n: s.step })

    if (bounded) {
        return f.t('word.stepBounded', { every, start: label(s.a), end: label(s.b) })
    }

    return s.a ? f.t('word.stepStarting', { every, start: label(s.a) }) : every
}

/** Words for the plain numbers in one field. */
const rangeWords = (s: Shape, key: FieldKey, f: Formatter) => {
    const bounded = s.k === 'step' && !even(s, key)

    if (key === 'second' || key === 'minute' || key === 'hour') {
        return cadenceText(s, key, bounded, f)
    }

    if (key === 'day') {
        return domText(s, bounded, f)
    }

    if (key === 'year') {
        return s.k === 'range' ? f.t('word.timeRange', { start: s.a, end: s.b }) : f.t('word.yearList', { years: f.list(s.vals.map(String)) })
    }

    return key === 'month' ? monthText(s, bounded, f) : dowText(s, f)
}

/** Words for one field, or null when the field is unrestricted. Special items are added to the plain values, never instead of them. */
export const fieldWords = (p: ParsedField, key: FieldKey, f: Formatter): string | null => {
    if (!p.ok) {
        return p.error ? f.t(p.error.id, p.error.params) : null
    }

    if (p.star) {
        return null
    }

    const s = shape(p, key)

    // Values that already cover the field leave it unrestricted, whatever special items come with them.
    if (s.k === 'any') {
        return null
    }

    const plain = p.set.size ? rangeWords(s, key, f) : null
    const ext = p.items.flatMap(item => (item.t === 'range' ? [] : [extText(item, f)]))

    return ext.length ? f.list([...(plain ? [plain] : []), ...ext]) : plain
}

/** The hover label for every chip, null where the field is unrestricted. */
export const chipWords = (c: Compiled, options: FormatOptions = {}): Partial<Record<FieldKey, string | null>> => {
    const f = options.fmt ?? formatter(options)
    const words: Partial<Record<FieldKey, string | null>> = {}
    const logic = dayLogic(c)

    for (const key of c.profile.fields) {
        const p = c.parsed[key]

        words[key] = p ? fieldWords(p, key, f) : null
    }

    const dom = words.day
    const dow = words.weekday

    if (dom && dow && (logic === 'or' || logic === 'and')) {
        const id = logic === 'or' ? 'word.either' : 'word.both'

        words.day = f.t(id, { first: dom, second: dow })
        words.weekday = f.t(id, { first: dow, second: dom })
    }

    for (const key of c.profile.fields) {
        words[key] = words[key] ? f.cap(words[key]) : null
    }

    return words
}
