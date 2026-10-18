import { dateClock, type Clock } from '../core/clock.ts'
/*
 * The line under the field: an error with a fix where one exists, a warning, or the schedule in words.
 * Every string comes from the translator.
 */
import { describe as builtInDescribe, neverReason } from '../core/describe.ts'
import { sorted, type FieldKey } from '../core/fields.ts'
import { matchRuns } from '../core/schedule.ts'
import { dayLogic, everyDay, type Compiled, type Issue } from '../core/syntax.ts'
import type { TargetBase } from '../core/target.ts'
import { formatter, type FormatOptions } from '../i18n/locale.ts'
import { english, type Translator } from '../i18n/translate.ts'
import type { Changes } from './menus.ts'

export type Message = { text: string; bad: boolean; fix?: { label: string; changes: Changes; field: FieldKey } }

export type DescribeContext = { compiled: Compiled; timezone: string | undefined; builtIn: () => string | null }
export type Describe = (value: string, context: DescribeContext) => string | null

export type Status = {
    valid: boolean
    message: Message | null
    /** The schedule in words, when it is valid. */
    description: string | null
}

export type StatusOptions = FormatOptions & {
    timezone?: string | undefined
    describe?: Describe | undefined
    /** The clock that checks the schedule runs at all; the Temporal entry passes one on Temporal. */
    clock?: Clock | undefined
}

/** An issue from the parser, in words. */
export const issueText = (issue: Issue, t: Translator = english) => t(issue.id, issue.params)

const fixLabel = (field: FieldKey, token: string, t: Translator) => (token === '*' ? t('ui.clearField', { field }) : t('fix.use', { token }))

/** The smallest gap between runs inside an hour, in minutes, or null when it is an hour or more. */
const shortestGap = (c: Compiled): number | null => {
    const minutes = sorted(c.parsed.minute?.set ?? [])
    const hours = c.parsed.hour?.set ?? new Set()
    const consecutive = [...hours].some(h => hours.has((h + 1) % 24))
    const gaps = minutes.slice(1).map((m, i) => m - (minutes[i] ?? 0))
    const first = minutes[0]
    const last = minutes.at(-1)

    if (first !== undefined && last !== undefined && consecutive) {
        gaps.push(60 - last + first)
    }

    return gaps.length ? Math.min(...gaps) : null
}

/** The error, warning or fix for a compiled schedule, or null when it is fine. Engine checks are in `status`. */
export const messageFor = (c: Compiled, t: Translator = english): Message | null => {
    const profile = c.profile
    const bad = profile.fields.find(key => c.parsed[key]?.error)
    const issue = bad ? c.parsed[bad]?.error : null
    const dom = c.parsed.day
    const dow = c.parsed.weekday
    const gap = profile.minInterval ? shortestGap(c) : null

    if (c.structure) {
        return { text: issueText(c.structure, t), bad: true }
    }

    if (bad && issue) {
        return {
            text: t('message.fieldError', { label: t('field.label', { field: bad }), error: issueText(issue, t) }),
            bad: true,
            ...(issue.fix ? { fix: { label: t('fix.use', { token: issue.fix }), changes: { [bad]: issue.fix }, field: bad } } : {}),
        }
    }

    if (c.issue) {
        const [field, token] = Object.entries(c.issue.fix ?? {})[0] ?? []

        return {
            text: issueText(c.issue, t),
            bad: true,
            ...(field && token ? { fix: { label: fixLabel(field as FieldKey, token, t), changes: c.issue.fix ?? {}, field: field as FieldKey } } : {}),
        }
    }

    // A restricted day field that still covers every day makes either-may-match targets run every day.
    if (dom && dow && dayLogic(c) === 'or') {
        for (const [key, other] of [
            ['day', 'weekday'],
            ['weekday', 'day'],
        ] as const) {
            const p = key === 'day' ? dom : dow

            if (everyDay(p, key)) {
                return {
                    text: t('warning.coversEvery', { token: c.raws[key] ?? '', field: key, other }),
                    bad: false,
                    fix: { label: t('fix.use', { token: '*' }), changes: { [key]: '*' }, field: key },
                }
            }
        }
    }

    if (profile.minInterval && gap !== null && gap < profile.minInterval) {
        return { text: t('warning.minInterval', { target: profile.label, minutes: profile.minInterval }), bad: false }
    }

    return null
}

/**
 * Everything the field shows for a value: the parser's message first, then whether the target's library
 * accepts it, then whether it ever runs, and otherwise the schedule in words.
 */
export const status = (value: string, c: Compiled, target: TargetBase, options: StatusOptions = {}): Status => {
    const f = options.fmt ?? formatter(options)
    const t = f.t
    const message = messageFor(c, t)
    const timezone = options.timezone ?? target.profile.timezone
    const zone = timezone === undefined ? {} : { timezone }
    const builtIn = () => builtInDescribe(c, { ...zone, fmt: f })

    if (message?.bad || !c.ok) {
        return { valid: false, message, description: null }
    }

    const checked = target.validate?.(value)

    if (checked && !checked.ok) {
        return { valid: false, message: { text: t('error.engine', { target: target.profile.label, detail: checked.message }), bad: true }, description: null }
    }

    const clock = options.clock ?? dateClock

    // The built-in matcher answers whether it runs at all; the target's library has already validated it.
    if (!matchRuns(c, { from: clock.now(), count: 1, timezone }, clock).length) {
        return { valid: false, message: { text: issueText(neverReason(c, f), t), bad: true }, description: null }
    }

    const description = options.describe ? options.describe(value, { compiled: c, timezone, builtIn }) : builtIn()

    return { valid: true, message, description }
}
