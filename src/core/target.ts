/*
 * A target as the field uses it: the syntax profile, plus the library that runs the job when an adapter
 * supplies one. Without a library, validation and previews come from the built-in parser and matcher.
 */
import { nextRuns as builtInRuns, runCount, type RunsOptions } from './schedule.ts'
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

/** A library's next `count` runs after `from`, in order and each once. When repeats leave a full batch short, it asks again for twice as many, twice at most. */
export const libraryRuns = <T>(next: (count: number) => T[], from: number, count: number, time: (run: T) => number): T[] => {
    const ask = (size: number, retries: number): T[] => {
        const batch = next(size)
        const runs = inOrder(batch, from, time)

        return runs.length < count && batch.length >= size && retries ? ask(size * 2, retries - 1) : runs.slice(0, count)
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
          )
        : builtIn
}

export type { RunsOptions }
