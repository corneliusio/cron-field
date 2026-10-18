/*
 * The cron fields every target is built from. A target picks which of them it uses and in what order;
 * the rest of the package always works with keys, never positions.
 */
export type FieldKey = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'weekday' | 'year'

export type FieldSpec = {
    key: FieldKey
    min: number
    max: number
    names?: string[]
    nameBase?: number
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Days in each month of a common year. */
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** A field's values in order. */
export const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b)

const MONTH_ABBR = MONTHS.map(month => month.slice(0, 3).toLowerCase())
const DAY_ABBR = DAYS.map(day => day.slice(0, 3).toLowerCase())

/** Weekdays are always 0 (Sunday) to 6 inside the package; targets that count from 1 convert when parsing and writing. */
export const FIELDS: Record<FieldKey, FieldSpec> = {
    second: { key: 'second', min: 0, max: 59 },
    minute: { key: 'minute', min: 0, max: 59 },
    hour: { key: 'hour', min: 0, max: 23 },
    day: { key: 'day', min: 1, max: 31 },
    month: { key: 'month', min: 1, max: 12, names: MONTH_ABBR, nameBase: 1 },
    weekday: { key: 'weekday', min: 0, max: 6, names: DAY_ABBR, nameBase: 0 },
    year: { key: 'year', min: 1970, max: 2199 },
}
