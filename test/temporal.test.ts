/*
 * The experimental Temporal entry: the same schedules give the same instants as the Date core, run times come back as
 * ZonedDateTime, and names and times are spelled the same through Temporal.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Cron } from 'croner'
import { croner } from '../src/adapters/croner.ts'
import { dateClock } from '../src/core/clock.ts'
import { matchRuns } from '../src/core/schedule.ts'
import {
    chipWords,
    compile,
    describe,
    formatter,
    fromDateTarget,
    menu,
    nextRuns,
    status,
    TARGETS,
    temporalClock,
    upcoming,
} from '../src/experimental/temporal/index.ts'
import { describe as describeDate, formatter as formatterDate } from '../src/index.ts'

const zones = ['UTC', 'America/Chicago', 'Europe/Berlin', 'Australia/Lord_Howe', 'Asia/Kolkata', 'America/St_Johns']
const values = ['0 9 * * 1-5', '*/15 * * * *', '30 2 * * *', '30 1 * * *', '0 0 L * *', '0 9 * * 1#2', '45 23 31 * *', '0 */3 * * 0,6', '0 0 29 2 *']
// Starts around DST changes in the zones above, and ordinary days.
const starts = [
    '2026-03-07T12:00:00Z',
    '2026-03-28T12:00:00Z',
    '2026-04-04T12:00:00Z',
    '2026-10-03T12:00:00Z',
    '2026-10-24T12:00:00Z',
    '2026-10-31T12:00:00Z',
    '2026-06-15T00:00:00Z',
]

test('the Temporal clock gives the same instants as the Date clock', () => {
    for (const value of values) {
        const c = compile(value, TARGETS.croner)

        for (const timezone of zones) {
            for (const start of starts) {
                const from = Date.parse(start)
                const options = { from, count: 6, timezone }

                assert.deepEqual(matchRuns(c, options, temporalClock), matchRuns(c, options, dateClock), `${value} in ${timezone} from ${start}`)
            }
        }
    }
})

test('run times come back as ZonedDateTime in the schedule’s zone', () => {
    const runs = nextRuns(compile('0 9 * * 1-5', TARGETS.github), { from: Temporal.Instant.from('2026-10-16T12:00:00Z'), count: 2 })

    assert.ok(runs[0] instanceof Temporal.ZonedDateTime)
    assert.deepEqual(
        runs.map(run => run.toString()),
        ['2026-10-19T09:00:00+00:00[UTC]', '2026-10-20T09:00:00+00:00[UTC]'],
    )

    const chicago = nextRuns(compile('30 2 * * *', TARGETS.croner), {
        from: Temporal.ZonedDateTime.from('2026-03-08T00:00:00-06:00[America/Chicago]'),
        timezone: 'America/Chicago',
    })

    // 2:30 doesn't exist on the day clocks spring forward, so it moves past the gap.
    assert.equal(chicago[0]?.toString(), '2026-03-08T03:30:00-05:00[America/Chicago]')
})

test('names and times read the same spelled through Temporal', () => {
    for (const locale of ['en', 'en-GB', 'de', 'fr', 'ja', 'ko', 'zh', 'ar']) {
        for (const hourCycle of ['h11', 'h12', 'h23', 'h24'] as const) {
            // Node 26's Temporal formatting drops the zero-padding of Japanese 24-hour times (7:05, where Date gives 07:05).
            if (locale === 'ja' && (hourCycle === 'h23' || hourCycle === 'h24')) {
                continue
            }

            const a = formatter({ locale, hourCycle })
            const b = formatterDate({ locale, hourCycle })

            assert.deepEqual(
                [
                    a.time(0, 0),
                    a.time(7, 5),
                    a.time(19, 30),
                    a.hour(0),
                    a.hour(12),
                    a.hour(17),
                    a.month(3),
                    a.month(9, 'short'),
                    a.weekday(0),
                    a.weekday(4, 'narrow'),
                ],
                [
                    b.time(0, 0),
                    b.time(7, 5),
                    b.time(19, 30),
                    b.hour(0),
                    b.hour(12),
                    b.hour(17),
                    b.month(3),
                    b.month(9, 'short'),
                    b.weekday(0),
                    b.weekday(4, 'narrow'),
                ],
                `${locale} ${hourCycle}`,
            )
        }
    }

    for (const value of values) {
        assert.equal(describe(compile(value, TARGETS.croner), { locale: 'de' }), describeDate(compile(value, TARGETS.croner), { locale: 'de' }), value)
    }

    assert.equal(chipWords(compile('0 9-17 * * *', TARGETS.croner), { locale: 'de' }).hour, '09:00–17:00')
    assert.equal(menu('year', compile('0 0 1 1 ? *', TARGETS.eventbridge)).sections[0]?.presets[1]?.[1].year, String(Temporal.Now.plainDateISO().year))
})

test('a Date-based library target works through fromDateTarget', () => {
    const target = fromDateTarget(croner(Cron, { timezone: 'UTC' }))
    const runs = upcoming(target, '0 9 * * 1-5', { from: Temporal.Instant.from('2026-10-16T12:00:00Z'), count: 2 })

    assert.deepEqual(
        runs.map(run => run.toString()),
        ['2026-10-19T09:00:00+00:00[UTC]', '2026-10-20T09:00:00+00:00[UTC]'],
    )
    assert.equal(status('0 0 31 2 *', compile('0 0 31 2 *', target.profile), target).message?.text, 'February never has a 31st.')
})
