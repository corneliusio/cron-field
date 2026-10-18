/*
 * A target as the field uses it: the syntax profile, plus the library that runs the job when an adapter
 * supplies one. Without a library, validation and previews come from the built-in parser and matcher.
 */
import { dateEngine } from './engine.ts'
import { nextRuns as builtInRuns, runCount, SETTLE, type RunsOptions } from './schedule.ts'
import { compile } from './syntax.ts'
import { TARGETS, type TargetName, type TargetProfile } from './targets.ts'

export type Validation = { ok: true } | { ok: false; message: string }

/** What the field itself needs from a target: its syntax, and its library's check. Run times are an entry's own business. */
export type TargetBase = {
    profile: TargetProfile
    /** Whether the library accepts the value. Runs after the built-in parser, which explains its errors. */
    validate?: (value: string) => Validation
}

export type Target = TargetBase & {
    /** Upcoming runs from the library. Should return an empty array for a schedule that never runs. */
    nextRuns?: (value: string, options: RunsOptions) => Date[]
}

export type TargetInput = TargetName | TargetProfile | Target

export const DEFAULT_TARGET: TargetName = 'vixie'

/** Any entry's target from a name, a profile or the target itself. Each entry wraps it with its own target type. */
export const resolveAny = (input: TargetName | TargetProfile | TargetBase = DEFAULT_TARGET): TargetBase => {
    if (typeof input !== 'string') {
        return 'profile' in input ? input : { profile: input }
    }

    const profile = TARGETS[input]

    if (!profile) {
        throw new Error(`Unknown cron-field target “${input}”.`)
    }

    return { profile }
}

export const resolveTarget = (input: TargetInput = DEFAULT_TARGET): Target => resolveAny(input)

/** A library's runs after `from` in order, each instant once: croner misorders runs in a DST gap and repeats up to an hour of them after a midnight gap. */
const inOrder = <T>(runs: T[], from: number, time: (run: T) => number): T[] =>
    [...new Map(runs.filter(run => time(run) > from).map(run => [time(run), run])).values()].sort((a, b) => time(a) - time(b))

/** The zone's offset from UTC at `time`. Engines agree on it, so the Date one serves both entries. */
const offsetAt = (time: number, timezone: string | undefined) => {
    const { y, mo, d, h, mi, s } = dateEngine.wall(time, timezone)

    return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(time / 1000) * 1000
}

/**
 * A library's next `count` runs after `from`, in order and each once, asking again, twice at most, when a full batch falls short.
 * It is short when repeats leave fewer runs than wanted, or when the zone shifts before the last run wanted and the batch ends less
 * than `SETTLE` past it: a run the library puts out of order in a DST gap can come after that. The next batch is twice as large, or
 * as large as the runs' spacing says it takes to reach `SETTLE` past.
 */
export const libraryRuns = <T>(next: (count: number) => T[], from: number, count: number, time: (run: T) => number, timezone: string | undefined): T[] => {
    const ask = (size: number, retries: number): T[] => {
        const batch = next(size)
        const runs = inOrder(batch, from, time)
        const last = runs[count - 1]
        const end = Math.max(...batch.map(time))
        const reach = last ? time(last) + SETTLE : end
        const settled = end >= reach || offsetAt(from, timezone) === offsetAt(reach, timezone)
        const grown = settled ? size * 2 : Math.max(size * 2, Math.ceil((batch.length * (reach - from)) / Math.max(end - from, 1)))

        return (runs.length < count || !settled) && batch.length >= size && retries ? ask(grown, retries - 1) : runs.slice(0, count)
    }

    return ask(count, 2)
}

/**
 * Upcoming runs, from the target's library when it has one. The built-in matcher goes first, so a schedule
 * that never runs, such as February 31st, returns at once instead of leaving a library searching for a match.
 */
export const upcoming = (target: Target, value: string, { from = new Date(), count = 1, timezone }: Partial<RunsOptions> = {}): Date[] => {
    const runs = target.nextRuns
    const options: RunsOptions = { from, count: runCount(count), timezone: timezone ?? target.profile.timezone }
    const builtIn = builtInRuns(compile(value, target.profile), runs ? { ...options, count: Math.min(options.count, 1) } : options)

    return runs && builtIn.length
        ? libraryRuns(
              size => runs(value, { ...options, count: size }),
              from.getTime(),
              options.count,
              date => date.getTime(),
              options.timezone,
          )
        : builtIn
}

export type { RunsOptions }
