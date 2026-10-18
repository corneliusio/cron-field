/*
 * The built-in matcher: upcoming runs of a compiled schedule, by the target's rules. Adapters replace
 * it with the parser library that actually runs the job; this one covers targets with no library,
 * such as Vercel or GitHub Actions, and checks whether a schedule runs at all. It works in plain calendar
 * numbers and epoch milliseconds; a clock does the time-zone conversion.
 */
import { dateClock, type Clock } from './clock.ts'
import { sorted } from './fields.ts'
import { dayLogic, type Compiled, type ParsedField } from './syntax.ts'

export type NextRunsOptions = {
    from?: Date
    count?: number
    /** An IANA zone such as `America/Chicago`, or `UTC`. Omitted means the runtime's local time. */
    timezone?: string
}

export type MatchOptions = { from: number; count: number; timezone?: string | undefined }

/** Years searched past the start when the schedule has no year field: long enough for Feb 29 on a given weekday. */
const HORIZON_YEARS = 50
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
// Sakamoto's method: a month's offset in the weekday cycle.
const MONTH_SHIFT = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
const daysInMonth = (y: number, mo: number) => (mo === 2 && leap(y) ? 29 : (MONTH_DAYS[mo - 1] ?? 31))

/** The weekday of a calendar date, 0 (Sunday) to 6. */
const weekdayOf = (y: number, mo: number, d: number) => {
    const year = mo < 3 ? y - 1 : y

    return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + (MONTH_SHIFT[mo - 1] ?? 0) + d) % 7
}

const values = (p: ParsedField | undefined, fallback: number[]) => (p ? sorted(p.set) : fallback)

const nearestWeekday = (y: number, mo: number, day: number) => {
    const last = daysInMonth(y, mo)
    const wd = weekdayOf(y, mo, day)

    if (day > last) {
        return -1
    }

    if (wd === 6) {
        return day === 1 ? 3 : day - 1
    }

    if (wd === 0) {
        return day === last ? day - 2 : day + 1
    }

    return day
}

const lastWeekday = (y: number, mo: number) => {
    const last = daysInMonth(y, mo)
    const wd = weekdayOf(y, mo, last)

    return wd === 6 ? last - 1 : wd === 0 ? last - 2 : last
}

/** Whether a calendar day matches the day fields, combined the target's way. */
export const dayMatches = (c: Compiled, y: number, mo: number, d: number) => {
    const logic = dayLogic(c)
    const last = daysInMonth(y, mo)
    const wd = weekdayOf(y, mo, d)
    const dom = () =>
        !!c.parsed.day &&
        (c.parsed.day.set.has(d) ||
            c.parsed.day.items.some(item => {
                if (item.t === 'last') {
                    return d === last - item.off
                }

                return item.t === 'lastWeekday' ? d === lastWeekday(y, mo) : item.t === 'nearest' && d === nearestWeekday(y, mo, item.day)
            }))
    const dow = () =>
        !!c.parsed.weekday &&
        (c.parsed.weekday.set.has(wd) ||
            c.parsed.weekday.items.some(item => {
                if (item.t === 'nth') {
                    return wd === item.dow && Math.ceil(d / 7) === item.k
                }

                return item.t === 'lastDow' && wd === item.dow && d + 7 > last
            }))

    if (logic === 'any') {
        return true
    }

    if (logic === 'dom' || logic === 'dow') {
        return logic === 'dom' ? dom() : dow()
    }

    return logic === 'or' ? dom() || dow() : dom() && dow()
}

/** The next runs after `from`, in epoch milliseconds, by the built-in matcher and a clock. Empty when the schedule doesn't parse or never runs. */
export const matchRuns = (c: Compiled, { from, count, timezone }: MatchOptions, clock: Clock): number[] => {
    const out: number[] = []
    const start = clock.wall(from, timezone)
    const seconds = values(c.parsed.second, [0])
    const minutes = values(c.parsed.minute, range(0, 59))
    const hours = values(c.parsed.hour, range(0, 23))
    const months = values(c.parsed.month, range(1, 12))
    // A year field limits the search to its years, and `*` to the target's, within the horizon.
    const years = c.parsed.year
        ? values(c.parsed.year, []).filter(y => y >= start.y && (!c.parsed.year?.star || y <= start.y + HORIZON_YEARS))
        : range(start.y, start.y + HORIZON_YEARS)

    if (!c.ok) {
        return out
    }

    for (const y of years) {
        for (const mo of months) {
            if (y === start.y && mo < start.mo) {
                continue
            }

            for (let d = y === start.y && mo === start.mo ? start.d : 1; d <= daysInMonth(y, mo); d++) {
                if (!dayMatches(c, y, mo, d)) {
                    continue
                }

                for (const h of hours) {
                    for (const mi of minutes) {
                        // Offsets change on whole minutes, so one conversion per minute covers its seconds.
                        const minute = clock.instant({ y, mo, d, h, mi, s: 0 }, timezone)

                        for (const s of seconds) {
                            const time = minute + s * 1000

                            if (time > from && !out.includes(time)) {
                                out.push(time)

                                if (out.length >= count) {
                                    return out
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return out
}

/** The next runs after `from`, by the built-in matcher. Empty when the schedule doesn't parse or never runs. */
export const nextRuns = (c: Compiled, { from = new Date(), count = 1, timezone = c.profile.timezone }: NextRunsOptions = {}): Date[] =>
    matchRuns(c, { from: from.getTime(), count, timezone }, dateClock).map(time => new Date(time))
