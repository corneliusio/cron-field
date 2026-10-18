/*
 * cron-parser as the target. Pass `CronExpressionParser`; with `strict`, cron-parser refuses both day
 * fields at once, and the field then sets only one of them.
 *
 *     import { CronExpressionParser } from 'cron-parser'
 *     cronParser(CronExpressionParser, { timezone: 'Europe/Berlin' })
 */
import type { Target } from '../core/target.ts'
import { fieldsFor, TARGETS } from '../core/targets.ts'

type Expression = { next(): { toDate(): Date } }

export type CronExpressionParserClass = {
    parse(expression: string, options?: { currentDate?: Date; tz?: string; strict?: boolean }): Expression
}

export type CronParserOptions = {
    /** Adds the seconds field in front. Strict mode always has it. */
    seconds?: boolean
    timezone?: string
    /** Requires all six fields and refuses both day fields at once. */
    strict?: boolean
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const cronParser = (Parser: CronExpressionParserClass, options: CronParserOptions = {}): Target => {
    const { timezone, strict = false } = options
    // Strict mode also requires the seconds field.
    const seconds = strict || (options.seconds ?? false)
    const parse = (value: string, from?: Date, zone = timezone) =>
        Parser.parse(value, { strict, ...(from ? { currentDate: from } : {}), ...(zone ? { tz: zone } : {}) })

    return {
        profile: {
            ...TARGETS['cron-parser'],
            fields: fieldsFor(seconds),
            ...(strict ? { days: 'exclusive' as const } : {}),
            ...(timezone ? { timezone } : {}),
        },
        validate: value => {
            try {
                parse(value)

                return { ok: true }
            } catch (error) {
                return { ok: false, message: message(error) }
            }
        },
        nextRuns: (value, { from, count, timezone: zone }) => {
            const out: Date[] = []

            try {
                const expression = parse(value, from, zone)

                while (out.length < count) {
                    out.push(expression.next().toDate())
                }
            } catch {
                // cron-parser throws once it runs out of dates.
            }

            return out
        },
    }
}
