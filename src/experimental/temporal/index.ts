/*
 * cron-field on Temporal. Experimental: the API may change, and it needs `globalThis.Temporal`, native or a
 * polyfill loaded first. It is the same field and core as `cron-field`, with Temporal in place of Date
 * wherever the API deals in time: run times come back as `Temporal.ZonedDateTime`, `from` takes an Instant or
 * a ZonedDateTime, and the field spells times and names through Temporal.
 *
 *     import { createCronField, nextRuns, compile, TARGETS } from 'cron-field/experimental/temporal'
 *
 * Date appears only in `fromDateTarget`, which adapts targets whose parser library works in Date.
 */
import { describe as describeWith, neverReason as neverReasonWith, type DescribeOptions, type NeverOptions } from '../../core/describe.ts'
import type { Engine } from '../../core/engine.ts'
import { matchRuns, runCount } from '../../core/schedule.ts'
import { compile, type Compiled, type Issue } from '../../core/syntax.ts'
import { libraryRuns, resolveAny, type Target as DateTarget, type TargetBase } from '../../core/target.ts'
import type { TargetName, TargetProfile } from '../../core/targets.ts'
import { createFieldWith, type CronFieldInstanceOf, type CronFieldOptionsOf } from '../../dom/create.ts'
import { formatter as formatterWith, type Formatter, type FormatOptions, type FormatterOptions } from '../../i18n/locale.ts'
import { menu as menuWith, type Menu, type MenuKey, type MenuOptions } from '../../model/menus.ts'
import { status as statusWith, type Status, type StatusOptions } from '../../model/messages.ts'
import { chipWords as chipWordsWith } from '../../model/words.ts'

export * from '../../index.ts'

export type RunsOptions = {
    /** Defaults to now. */
    from?: Temporal.Instant | Temporal.ZonedDateTime | undefined
    count?: number | undefined
    /** An IANA zone such as `America/Chicago`. Defaults to the target's, else the runtime's. */
    timezone?: string | undefined
}

export type Target = TargetBase & {
    /** Upcoming runs from the target's library. Should return an empty array for a schedule that never runs. */
    nextRuns?: (value: string, options: { from: Temporal.ZonedDateTime; count: number; timezone: string }) => Temporal.ZonedDateTime[]
}

export type TargetInput = TargetName | TargetProfile | Target
export type CronFieldOptions = CronFieldOptionsOf<Target>
export type CronFieldInstance = CronFieldInstanceOf<Target>

/** Temporal, or a clear error where the runtime has none. Looked up on use, so importing this entry never throws. */
const temporal = (): typeof Temporal => {
    if (typeof Temporal === 'undefined') {
        throw new Error('cron-field/experimental/temporal needs Temporal. Load a polyfill, such as temporal-polyfill, before using it.')
    }

    return Temporal
}

const known = new Map<string, boolean>()

/** The zone, or the runtime's, with one warning, for a zone the runtime doesn't know, as the Date engine does. */
const zoneOf = (timezone?: string) => {
    if (timezone && !known.has(timezone)) {
        try {
            temporal().Now.zonedDateTimeISO(timezone)
            known.set(timezone, true)
        } catch {
            console.warn(`cron-field: unknown time zone “${timezone}”; using local time.`)
            known.set(timezone, false)
        }
    }

    return timezone && known.get(timezone) ? timezone : temporal().Now.timeZoneId()
}
const zoned = (time: number, timezone: string) => temporal().Instant.fromEpochMilliseconds(time).toZonedDateTimeISO(timezone)

/**
 * A two-digit hour the runtime left at one digit, padded in the locale's digits. The hour is the first digit on its own, as
 * minutes always have two; where the runtime already pads, nothing matches. Digits are the locale's own, since some, such as
 * Chinese decimal ones, aren't Unicode digits.
 */
const padHour = (text: string, tag: string, hour: number) => {
    const numbers = new Intl.NumberFormat(tag, { useGrouping: false })
    const digits = `[\\p{Nd}${Array.from({ length: 10 }, (_, n) => numbers.format(n)).join('')}]`

    return hour < 10
        ? text.replace(
              new RegExp(`(?<!${digits})${numbers.format(hour)}(?!${digits})`, 'u'),
              new Intl.NumberFormat(tag, { minimumIntegerDigits: 2 }).format(hour),
          )
        : text
}

/**
 * The engine on Temporal. `compatible` is the field's DST rule: a skipped time moves past the gap, a repeated one takes
 * the first. Times are spelled through PlainTime and names through PlainDate, which carry no zone to shift them. The
 * hour cycle goes in the locale tag: some runtimes ignore the `hourCycle` option for Temporal values in some locales
 * (Japanese midnight on a 12-hour clock reads 午前0時 rather than 午前12時) but honor `-u-hc-`. Node 26 also drops the
 * padding of a two-digit hour in some locales, such as Japanese, Hebrew and Persian (7:05 where Date gives 07:05), so `padHour`
 * puts it back.
 */
export const temporalEngine: Engine = {
    now: () => temporal().Now.instant().epochMilliseconds,
    instant: ({ y, mo, d, h, mi, s }, timezone) =>
        temporal().ZonedDateTime.from(
            { year: y, month: mo, day: d, hour: h, minute: mi, second: s, timeZone: zoneOf(timezone) },
            { disambiguation: 'compatible' },
        ).epochMilliseconds,
    wall: (time, timezone) => {
        const at = zoned(time, zoneOf(timezone))

        return { y: at.year, mo: at.month, d: at.day, h: at.hour, mi: at.minute, s: at.second }
    },
    spell: (locale, { hourCycle, ...options }, { month = 1, day = 1, hour, minute = 0, second = 0 }) => {
        const tag = hourCycle ? new Intl.Locale(locale, { hourCycle }).toString() : locale

        if (hour === undefined) {
            return temporal().PlainDate.from({ year: 2001, month, day }).toLocaleString(tag, options)
        }

        const text = new (temporal().PlainTime)(hour, minute, second).toLocaleString(tag, options)

        // On a 24-hour clock that reads midnight as 24, the hour shown is 24.
        return options.hour === '2-digit' ? padHour(text, tag, hourCycle === 'h24' && hour === 0 ? 24 : hour) : text
    },
}

export const formatter = (options: FormatterOptions = {}): Formatter => formatterWith(options, temporalEngine)

const withFormatter = <O extends FormatOptions>(options: O): O & { fmt: Formatter } => ({ ...options, fmt: options.fmt ?? formatter(options) })

export const describe = (c: Compiled, options: DescribeOptions = {}): string | null => describeWith(c, withFormatter(options))

export const chipWords = (c: Compiled, options: FormatOptions = {}) => chipWordsWith(c, withFormatter(options))

export const neverReason = (c: Compiled, f: Formatter = formatter(), options: NeverOptions = {}): Issue => neverReasonWith(c, f, options)

export const menu = (key: MenuKey, c: Compiled, options: MenuOptions = {}): Menu =>
    menuWith(key, c, { ...withFormatter(options), year: options.year ?? temporal().Now.plainDateISO().year })

export const status = (value: string, c: Compiled, target: TargetBase, options: StatusOptions = {}): Status =>
    statusWith(value, c, target, { ...withFormatter(options), engine: options.engine ?? temporalEngine })

/** The next runs after `from`, by the built-in matcher, in the schedule's zone. Empty when it doesn't parse or never runs. */
export const nextRuns = (c: Compiled, { from, count = 1, timezone = c.profile.timezone }: RunsOptions = {}): Temporal.ZonedDateTime[] => {
    const zone = zoneOf(timezone)

    return matchRuns(c, { from: from?.epochMilliseconds ?? temporalEngine.now(), count, timezone: zone }, temporalEngine).map(time => zoned(time, zone))
}

export const resolveTarget = (input?: TargetInput): Target => resolveAny(input)

/**
 * Upcoming runs, from the target's library when it has one. The built-in matcher goes first, so a schedule that never runs
 * returns at once instead of leaving a library searching.
 */
export const upcoming = (target: Target, value: string, { from, count = 1, timezone }: RunsOptions = {}): Temporal.ZonedDateTime[] => {
    const runs = target.nextRuns
    const zone = zoneOf(timezone ?? target.profile.timezone)
    const wanted = runCount(count)
    const builtIn = nextRuns(compile(value, target.profile), { from, count: runs ? Math.min(wanted, 1) : wanted, timezone: zone })
    const start = from === undefined ? temporal().Now.zonedDateTimeISO(zone) : zoned(from.epochMilliseconds, zone)

    return runs && builtIn.length
        ? libraryRuns(
              size => runs(value, { from: start, count: size, timezone: zone }),
              start.epochMilliseconds,
              wanted,
              run => run.epochMilliseconds,
              zone,
          )
        : builtIn
}

/**
 * A target whose parser library works in Date, such as `croner(Cron)`, as a Temporal target. The library still sees
 * Date; this converts at its edge, and is the one place this entry touches Date.
 */
export const fromDateTarget = (target: DateTarget): Target => {
    const runs = target.nextRuns

    return {
        profile: target.profile,
        ...(target.validate ? { validate: target.validate } : {}),
        ...(runs
            ? {
                  nextRuns: (value, { from, count, timezone }) =>
                      runs(value, { from: new Date(from.epochMilliseconds), count, timezone }).map(date => zoned(date.getTime(), timezone)),
              }
            : {}),
    }
}

export const createCronField = (root: HTMLElement, initial: CronFieldOptions = {}): CronFieldInstance => createFieldWith(temporalEngine, root, initial)
