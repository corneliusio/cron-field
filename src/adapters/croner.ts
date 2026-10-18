/*
 * croner as the target. Pass the `Cron` class and the options your job uses; the profile follows the
 * same options, so the field offers and describes exactly what croner will run.
 *
 *     import { Cron } from 'croner'
 *     croner(Cron, { domAndDow: true, timezone: 'America/Chicago' })
 */
import type { Target } from '../core/target.ts'
import { fieldsFor, TARGETS } from '../core/targets.ts'

type CronerJob = { nextRuns(n: number, previous?: Date): Date[] }
type CronerClass = new (pattern: string, options?: Record<string, unknown>) => CronerJob

export type CronerOptions = {
    /** 6 adds seconds in front; 7 also adds a year at the end. */
    parts?: 5 | 6 | 7
    timezone?: string
    /** Both day fields have to match, instead of either. */
    domAndDow?: boolean
    /** Sunday is 1 and Saturday is 7, as in Quartz. */
    alternativeWeekdays?: boolean
    /** Accepts a start with a step and no range, such as `5/15`. */
    sloppyRanges?: boolean
}

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^CronPattern: /, '') : String(error))

export const croner = (Cron: CronerClass, options: CronerOptions = {}): Target => {
    const { parts = 5, timezone, domAndDow = false, alternativeWeekdays = false, sloppyRanges = false } = options
    const settings = { mode: `${parts}-part`, domAndDow, alternativeWeekdays, sloppyRanges }
    const job = (value: string, zone = timezone) => new Cron(value, zone ? { ...settings, timezone: zone } : settings)

    return {
        profile: {
            ...TARGETS.croner,
            fields: fieldsFor(parts > 5, parts > 6),
            years: [1, 9999],
            days: domAndDow ? 'and' : 'or',
            weekdayBase: alternativeWeekdays ? 1 : 0,
            stepStart: sloppyRanges,
            // croner reads shortcuts as five fields, so its 6- and 7-part modes refuse them.
            ...(parts > 5 ? { macros: {} } : {}),
            ...(timezone ? { timezone } : {}),
        },
        validate: value => {
            try {
                job(value)

                return { ok: true }
            } catch (error) {
                return { ok: false, message: message(error) }
            }
        },
        nextRuns: (value, { from, count, timezone: zone }) => {
            try {
                return job(value, zone).nextRuns(count, from)
            } catch {
                return []
            }
        },
    }
}
