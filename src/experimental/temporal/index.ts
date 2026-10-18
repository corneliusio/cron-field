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
import type { Clock } from '../../core/clock.ts'
import { describe as describeWith, neverReason as neverReasonWith, type DescribeOptions } from '../../core/describe.ts'
import { matchRuns } from '../../core/schedule.ts'
import { compile, type Compiled, type Issue } from '../../core/syntax.ts'
import { DEFAULT_TARGET, resolveBase, type Target as DateTarget, type TargetBase } from '../../core/target.ts'
import type { TargetName, TargetProfile } from '../../core/targets.ts'
import { createFieldWith, type CronFieldInstanceOf, type CronFieldOptionsOf, type Engine } from '../../dom/create.ts'
import { formatter as formatterWith, type Formatter, type FormatOptions, type FormatterOptions, type Spell } from '../../i18n/locale.ts'
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

export type NextRunsOptions = RunsOptions

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

const zoneOf = (timezone?: string) => timezone ?? temporal().Now.timeZoneId()
const zoned = (time: number, timezone: string) => temporal().Instant.fromEpochMilliseconds(time).toZonedDateTimeISO(timezone)

/** The clock on Temporal. `compatible` is the field's DST rule: a skipped time moves past the gap, a repeated one takes the first. */
export const temporalClock: Clock = {
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
}

/**
 * Spells times through PlainTime and names through PlainDate, which carry no zone to shift them. The hour cycle goes in
 * the locale tag: some runtimes ignore the `hourCycle` option for Temporal values in some locales (Japanese midnight on a
 * 12-hour clock reads 午前0時 rather than 午前12時) but honor `-u-hc-`. Known gap: Node 26 also drops the zero-padding of
 * Japanese 24-hour times through Temporal, 7:05 where Date gives 07:05.
 */
export const spellTemporal: Spell = (locale, { hourCycle, ...options }, { month = 1, day = 1, hour, minute = 0 }) => {
    const tag = hourCycle ? new Intl.Locale(locale, { hourCycle }).toString() : locale

    return hour === undefined
        ? temporal().PlainDate.from({ year: 2001, month, day }).toLocaleString(tag, options)
        : new (temporal().PlainTime)(hour, minute).toLocaleString(tag, options)
}

const engine: Engine = { clock: temporalClock, spell: spellTemporal }

export const formatter = (options: FormatterOptions = {}): Formatter => formatterWith(options, spellTemporal)

const withFormatter = <O extends FormatOptions>(options: O): O & { fmt: Formatter } => ({ ...options, fmt: options.fmt ?? formatter(options) })

export const describe = (c: Compiled, options: DescribeOptions = {}): string | null => describeWith(c, withFormatter(options))

export const chipWords = (c: Compiled, options: FormatOptions = {}) => chipWordsWith(c, withFormatter(options))

export const neverReason = (c: Compiled, f: Formatter = formatter()): Issue => neverReasonWith(c, f)

export const menu = (key: MenuKey, c: Compiled, options: MenuOptions = {}): Menu =>
    menuWith(key, c, { ...withFormatter(options), year: options.year ?? temporal().Now.plainDateISO().year })

export const status = (value: string, c: Compiled, target: TargetBase, options: StatusOptions = {}): Status =>
    statusWith(value, c, target, { ...withFormatter(options), clock: options.clock ?? temporalClock })

/** The next runs after `from`, by the built-in matcher, in the schedule's zone. Empty when it doesn't parse or never runs. */
export const nextRuns = (c: Compiled, { from, count = 1, timezone = c.profile.timezone }: NextRunsOptions = {}): Temporal.ZonedDateTime[] => {
    const zone = zoneOf(timezone)

    return matchRuns(c, { from: from?.epochMilliseconds ?? temporalClock.now(), count, timezone: zone }, temporalClock).map(time => zoned(time, zone))
}

export const resolveTarget = (input: TargetInput = DEFAULT_TARGET): Target =>
    typeof input === 'object' && 'profile' in input ? input : { profile: resolveBase(input).profile }

/**
 * Upcoming runs, from the target's library when it has one. The built-in matcher goes first, so a schedule that never runs
 * returns at once instead of leaving a library searching.
 */
export const upcoming = (target: Target, value: string, { from, count = 1, timezone }: RunsOptions = {}): Temporal.ZonedDateTime[] => {
    const zone = zoneOf(timezone ?? target.profile.timezone)
    const builtIn = nextRuns(compile(value, target.profile), { from, count: target.nextRuns ? 1 : count, timezone: zone })
    const start = from === undefined ? temporal().Now.zonedDateTimeISO(zone) : zoned(from.epochMilliseconds, zone)

    return target.nextRuns && builtIn.length ? target.nextRuns(value, { from: start, count, timezone: zone }) : builtIn
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

export const createCronField = (root: HTMLElement, initial: CronFieldOptions = {}): CronFieldInstance => createFieldWith(engine, root, initial)
