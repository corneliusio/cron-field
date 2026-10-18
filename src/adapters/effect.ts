/*
 * Effect's `Cron` module as the target. Effect reads five fields, or six with seconds in front, and
 * no extensions; a field that starts with `*` makes both day fields required, as in Vixie cron.
 *
 *     import { Cron } from 'effect'
 *     effect(Cron, { timezone: 'UTC' })
 */
import type { Target } from '../core/target.ts'
import { fieldsFor, TARGETS } from '../core/targets.ts'

type Parsed<C> = { readonly _tag: 'Success'; readonly success: C } | { readonly _tag: 'Failure'; readonly failure: { readonly message: string } }

export type EffectCronModule<C = unknown> = {
    parse: (cron: string, tz?: string) => Parsed<C>
    sequence: (cron: C, now?: Date) => Iterator<Date>
}

export type EffectOptions = {
    /** Adds the seconds field in front. */
    seconds?: boolean
    timezone?: string
}

export const effect = <C>(Cron: EffectCronModule<C>, options: EffectOptions = {}): Target => {
    const { seconds = false, timezone } = options
    const parse = (value: string, zone = timezone) => (zone ? Cron.parse(value, zone) : Cron.parse(value))

    return {
        profile: { ...TARGETS.effect, fields: fieldsFor(seconds), ...(timezone ? { timezone } : {}) },
        validate: value => {
            const result = parse(value)

            return result._tag === 'Success' ? { ok: true } : { ok: false, message: result.failure.message }
        },
        nextRuns: (value, { from, count, timezone: zone }) => {
            const result = parse(value, zone)
            const out: Date[] = []

            if (result._tag === 'Failure') {
                return out
            }

            const runs = Cron.sequence(result.success, from)

            while (out.length < count) {
                const next = runs.next()

                if (next.done) {
                    break
                }

                out.push(next.value)
            }

            return out
        },
    }
}
