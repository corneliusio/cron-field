/*
 * Clocks: the two things the matcher needs from a date library. One turns a wall-clock time in a zone into
 * an instant, the other turns an instant back into a wall-clock time. Everything else the matcher does is
 * calendar arithmetic on plain numbers, so swapping the clock swaps the date library: this one uses Date and
 * Intl, and `cron-field/experimental/temporal` has one on Temporal.
 */

/** A wall-clock time: what a clock on the wall in some zone shows. */
export type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number }

export type Clock = {
    /** The current instant, in epoch milliseconds. */
    now: () => number
    /** The instant a wall-clock time names in a zone; omitted means the runtime's. Skipped times move past the gap, repeated ones take the first. */
    instant: (wall: Wall, timezone?: string) => number
    wall: (time: number, timezone?: string) => Wall
}

const DAY = 86_400_000
const formats = new Map<string, Intl.DateTimeFormat>()

const format = (timezone: string) => {
    let f = formats.get(timezone)

    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        })
        formats.set(timezone, f)
    }

    return f
}

const wallOf = (time: number, timezone?: string): Wall => {
    if (!timezone) {
        const date = new Date(time)

        return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds() }
    }

    if (timezone === 'UTC') {
        const date = new Date(time)

        return {
            y: date.getUTCFullYear(),
            mo: date.getUTCMonth() + 1,
            d: date.getUTCDate(),
            h: date.getUTCHours(),
            mi: date.getUTCMinutes(),
            s: date.getUTCSeconds(),
        }
    }

    const parts = Object.fromEntries(
        format(timezone)
            .formatToParts(new Date(time))
            .map(part => [part.type, Number(part.value)]),
    )

    return { y: parts.year ?? 0, mo: parts.month ?? 1, d: parts.day ?? 1, h: parts.hour ?? 0, mi: parts.minute ?? 0, s: parts.second ?? 0 }
}

/**
 * The instant a wall-clock time names in a zone. A time a DST change repeats takes its first occurrence; a time
 * it skips moves forward by the gap, as Date does for local times.
 */
const instantOf = (wall: Wall, timezone?: string) => {
    const { y, mo, d, h, mi, s } = wall

    if (!timezone) {
        return new Date(y, mo - 1, d, h, mi, s).getTime()
    }

    const guess = Date.UTC(y, mo - 1, d, h, mi, s)

    if (timezone === 'UTC') {
        return guess
    }

    const offset = (time: number) => {
        const at = wallOf(time, timezone)

        return Date.UTC(at.y, at.mo - 1, at.d, at.h, at.mi, at.s) - time
    }

    // The offsets either side of any transition that day, and the instants they give.
    const candidates = [guess - offset(guess - DAY), guess - offset(guess + DAY)]
    const matching = candidates.filter(time => {
        const at = wallOf(time, timezone)

        return at.d === d && at.h === h && at.mi === mi
    })

    return matching.length ? Math.min(...matching) : Math.max(...candidates)
}

/** The clock on Date, with Intl for named zones. */
export const dateClock: Clock = { now: Date.now, instant: instantOf, wall: wallOf }
