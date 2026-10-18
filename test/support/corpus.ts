import { CronExpressionParser } from 'cron-parser'
/*
 * The adapter parity corpus: schedules every croner, cron-parser and Effect setup runs, and the differences from each
 * library kept on purpose. Shared values are written in five fields; a setup with seconds gets `0 ` in front, one with
 * a year ` *` at the end. Shortcuts and the empty value stay as they are.
 */
import { Cron } from 'croner'
import { Cron as EffectCron } from 'effect'
import { cronParser } from '../../src/adapters/cron-parser.ts'
import { croner } from '../../src/adapters/croner.ts'
import { effect } from '../../src/adapters/effect.ts'
import type { Target } from '../../src/index.ts'

export type Setup = { name: string; target: Target; pins: string[] }

export const SHARED = [
    // Baseline, with spacing and lower-case names.
    '* * * * *',
    '0 9 * * 1-5',
    '0,30 8-18/2 * * *',
    '  0   9 * jan mon  ',
    // Weekday numbering: Sunday as 0 and 7, and steps that reach it.
    '0 0 * * 0',
    '0 0 * * 7',
    '0 0 * * 6-0',
    '0 0 * * 1/2',
    '0 0 * * 7/2',
    '0 0 * * */7',
    '0 0 * * 8',
    // Ranges past the field's end.
    '0 22-2 * * *',
    '0 9 * * FRI-MON',
    // Steps, and the largest step each library takes.
    '*/15 * * * *',
    '5/15 * * * *',
    '5-59/15 * * * *',
    '0-20/2 * * * *',
    '*/60 * * * *',
    '0 */24 * * *',
    '*/90 * * * *',
    '0 0 1/10 * *',
    // Names.
    '0 9 * JAN-MAR MON-FRI',
    '0 9 * * monday',
    // How the two day fields combine.
    '0 0 */2 * 1',
    '0 0 3 * 1',
    '0 0 1-31 * 1',
    '0 9 1-31,L * 1',
    '0 0 1,15 * 1-5',
    // ? in the day fields.
    '0 9 ? * 1',
    '0 9 1 * ?',
    '0 9 ? * ?',
    // Extensions.
    '0 9 L * *',
    '0 9 LW * *',
    '0 9 15W * *',
    '0 9 1W * *',
    '0 9 L-3 * *',
    '0 9 * * 5L',
    '0 9 * * 1#1',
    '0 9 * * 1#5',
    '0 9 * * 1#6',
    '0 9 1,L * *',
    '0 9 * * 1,5#2',
    '0 9 * * 1,5L',
    '0 9 * * L',
    '0 9 * * 5#L',
    // Shortcuts.
    '@daily',
    '@reboot',
    '@weekdays',
    '@DAILY',
    // Repeats, which cron-parser refuses. Sunday twice in one range, and a special next to a plain value, are not repeats.
    '0,0 9 * * *',
    '0 9 * * 1,1-5',
    '0 9 * * 0,7',
    '0 9-12,10 * * *',
    '0 0 1-10,5 * *',
    '0 0 */2,1 * *',
    '0 0 * * 1-5,3',
    '*/2,1 * * * *',
    '0 0 L,L * *',
    '0 0 * * 5L,FRIL',
    '0 0 * * 0-7',
    '0 0 31,L * *',
    // Field counts and values out of range.
    '0 9 * *',
    '0 0 9 * * *',
    '',
    '60 * * * *',
    // Days that never come, or come once in years.
    '0 9 31 2 *',
    '0 0 31 4,6,9,11 *',
    '0 0 29 2 1',
]

/** Six fields, seconds first, for setups with seconds. */
export const SECONDS = ['*/10 * * * * *', '5/15 0 9 * * *', '60 0 9 * * *', '0 0 9 ? * *', '0 0 9 1 * 1']

/** Seven fields, for croner's year. */
export const YEARS = ['0 0 0 1 1 * 2030-2032', '0 0 0 1 1 * 2200', '0 0 0 1 1 * */2']

/*
 * Pins: the difference from the library, as the test words it, with its reason. Two recur for croner:
 * - croner turns ? into * only after deciding how the day fields combine, so `0 9 ? * 1` runs every day. The profile refuses ? on purpose.
 * - croner 10.0.1 skips March 1 when it searches from late February:
 *   new Cron('0 0 1,31 * *', { timezone: 'UTC' }).nextRuns(2, new Date('2026-02-25T12:00Z')) gives March 31 and April 1.
 */
export const SETUPS: Setup[] = [
    {
        name: 'croner',
        target: croner(Cron, { timezone: 'UTC' }),
        pins: [
            // croner skips March 1.
            '0 0 1,15 * 1-5: from 2026-02-25, profile 2026-03-01T00:00, library 2026-03-02T00:00',
            // croner's ?.
            '0 9 ? * 1: profile rejects, library runs',
            '0 9 1 * ?: profile rejects, library runs',
            '0 9 ? * ?: profile rejects, library runs',
        ],
    },
    {
        name: 'croner with 6 parts',
        target: croner(Cron, { parts: 6, timezone: 'UTC' }),
        pins: [
            // croner skips March 1.
            '0 0 0 1,15 * 1-5: from 2026-02-25, profile 2026-03-01T00:00, library 2026-03-02T00:00',
            // croner's ?.
            '0 0 9 ? * 1: profile rejects, library runs',
            '0 0 9 1 * ?: profile rejects, library runs',
            '0 0 9 ? * ?: profile rejects, library runs',
            '0 0 9 ? * *: profile rejects, library runs',
            // croner skips March 1.
            '0 0 9 1 * 1: from 2026-02-25, profile 2026-03-01T09:00, library 2026-03-02T09:00',
        ],
    },
    {
        name: 'croner with 7 parts',
        target: croner(Cron, { parts: 7, timezone: 'UTC' }),
        pins: [
            // croner skips March 1.
            '0 0 0 1,15 * 1-5 *: from 2026-02-25, profile 2026-03-01T00:00, library 2026-03-02T00:00',
            // croner's ?.
            '0 0 9 ? * 1 *: profile rejects, library runs',
            '0 0 9 1 * ? *: profile rejects, library runs',
            '0 0 9 ? * ? *: profile rejects, library runs',
            '0 0 9 ? * * *: profile rejects, library runs',
            // croner skips March 1.
            '0 0 9 1 * 1 *: from 2026-02-25, profile 2026-03-01T09:00, library 2026-03-02T09:00',
        ],
    },
    {
        name: 'croner with domAndDow',
        target: croner(Cron, { domAndDow: true, timezone: 'UTC' }),
        pins: [
            // croner's ?.
            '0 9 ? * 1: profile rejects, library runs',
            '0 9 1 * ?: profile rejects, library runs',
            '0 9 ? * ?: profile rejects, library runs',
            // The built-in matcher looks 50 years ahead: February 29th falls on a Monday in 2044 and 2072, then not until 2112.
            '0 0 29 2 1: from 2026-02-25, profile none, library 2112-02-29T00:00',
            '0 0 29 2 1: from 2026-12-30, profile none, library 2112-02-29T00:00',
        ],
    },
    {
        name: 'croner with alternativeWeekdays',
        target: croner(Cron, { alternativeWeekdays: true, timezone: 'UTC' }),
        pins: [
            // croner reads 8 as Sunday again; Sunday-is-1 numbering ends at 7.
            '0 0 * * 8: profile rejects, library runs',
            // croner's ?.
            '0 9 ? * 1: profile rejects, library runs',
            '0 9 1 * ?: profile rejects, library runs',
            '0 9 ? * ?: profile rejects, library runs',
        ],
    },
    {
        name: 'croner with sloppyRanges',
        target: croner(Cron, { sloppyRanges: true, timezone: 'UTC' }),
        pins: [
            // croner accepts a step from Sunday written as 7 but never runs it, so the profile refuses it.
            '0 0 * * 7/2: profile rejects, library never runs',
            // croner skips March 1.
            '0 0 1/10 * *: from 2026-02-25, profile 2026-03-01T00:00, library 2026-03-11T00:00',
            '0 0 1,15 * 1-5: from 2026-02-25, profile 2026-03-01T00:00, library 2026-03-02T00:00',
            // croner's ?.
            '0 9 ? * 1: profile rejects, library runs',
            '0 9 1 * ?: profile rejects, library runs',
            '0 9 ? * ?: profile rejects, library runs',
        ],
    },
    {
        name: 'cron-parser',
        target: cronParser(CronExpressionParser, { timezone: 'UTC' }),
        pins: [
            // cron-parser takes a step longer than the field and runs only :00.
            '*/90 * * * *: profile rejects, library runs',
            // cron-parser guesses at other field counts: four fields run every minute of midnight on the 9th, six have seconds first,
            // and an empty value runs every minute.
            '0 9 * *: profile rejects, library runs',
            '0 0 9 * * *: profile rejects, library runs',
            '(empty): profile rejects, library runs',
        ],
    },
    {
        name: 'cron-parser with seconds',
        target: cronParser(CronExpressionParser, { seconds: true, timezone: 'UTC' }),
        pins: [
            // cron-parser takes a step longer than the field and runs only :00.
            '0 */90 * * * *: profile rejects, library runs',
            // cron-parser guesses at other field counts: five fields have no seconds, and an empty value runs every minute.
            '0 0 9 * *: profile rejects, library runs',
            '(empty): profile rejects, library runs',
        ],
    },
    {
        name: 'cron-parser strict',
        target: cronParser(CronExpressionParser, { strict: true, timezone: 'UTC' }),
        pins: [
            // cron-parser takes a step longer than the field and runs only :00.
            '0 */90 * * * *: profile rejects, library runs',
            // Strict cron-parser counts ? as a day field in use next to a set one, so the profile refuses ? everywhere.
            '0 0 9 ? * *: profile rejects, library runs',
        ],
    },
    {
        name: 'Effect',
        target: effect(EffectCron, { timezone: 'UTC' }),
        pins: [
            // Effect takes a weekday step of 7, Sundays only; the profile keeps steps to the field's highest value, 6.
            '0 0 * * */7: profile rejects, library runs',
            // Effect reads six fields as seconds first.
            '0 0 9 * * *: profile rejects, library runs',
        ],
    },
    {
        name: 'Effect with seconds',
        target: effect(EffectCron, { seconds: true, timezone: 'UTC' }),
        pins: [
            // Effect takes a weekday step of 7, Sundays only; the profile keeps steps to the field's highest value, 6.
            '0 0 0 * * */7: profile rejects, library runs',
            // Effect reads five fields as minutes first.
            '0 0 9 * *: profile rejects, library runs',
        ],
    },
]
