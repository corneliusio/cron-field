/*
 * A target as the field uses it: the syntax profile, plus the library that runs the job when an adapter
 * supplies one. Without a library, validation and previews come from the built-in parser and matcher.
 */
import { nextRuns as builtInRuns } from './schedule.ts'
import { compile } from './syntax.ts'
import { TARGETS, type TargetName, type TargetProfile } from './targets.ts'

export type Validation = { ok: true } | { ok: false; message: string }
export type RunsOptions = { from: Date; count: number; timezone?: string }

/** What the field itself needs from a target: its syntax, and its library's check. Run times are an entry's own business. */
export type TargetBase = { profile: TargetProfile; validate?: (value: string) => Validation }

export type Target = {
    profile: TargetProfile
    /** Whether the library accepts the value. Runs after the built-in parser, which explains its errors. */
    validate?: (value: string) => Validation
    /** Upcoming runs from the library. Should return an empty array for a schedule that never runs. */
    nextRuns?: (value: string, options: RunsOptions) => Date[]
}

export type TargetInput = TargetName | TargetProfile | Target

export const DEFAULT_TARGET: TargetName = 'vixie'

const isTarget = <T extends TargetBase>(input: TargetProfile | T): input is T => 'profile' in input

/** Any entry's target, as the field uses it. */
export const resolveBase = (input: TargetName | TargetProfile | TargetBase = DEFAULT_TARGET): TargetBase =>
    typeof input === 'string' ? resolveTarget(input) : isTarget(input) ? input : { profile: input }

export const resolveTarget = (input: TargetInput = DEFAULT_TARGET): Target => {
    if (typeof input === 'string') {
        const profile = TARGETS[input]

        if (!profile) {
            throw new Error(`Unknown cron-field target “${input}”.`)
        }

        return { profile }
    }

    return isTarget(input) ? input : { profile: input }
}

/**
 * Upcoming runs, from the target's library when it has one. The built-in matcher goes first, so a schedule
 * that never runs, such as February 31st, returns at once instead of leaving a library searching for a match.
 */
export const upcoming = (target: Target, value: string, { from = new Date(), count = 1, timezone }: Partial<RunsOptions> = {}): Date[] => {
    const zone = timezone ?? target.profile.timezone
    const options: RunsOptions = zone === undefined ? { from, count } : { from, count, timezone: zone }
    const builtIn = builtInRuns(compile(value, target.profile), target.nextRuns ? { ...options, count: 1 } : options)

    return target.nextRuns && builtIn.length ? target.nextRuns(value, options) : builtIn
}
