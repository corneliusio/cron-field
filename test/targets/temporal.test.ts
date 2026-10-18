/*
 * The experimental Temporal entry: run times come back as ZonedDateTime, Date-based library targets work through it,
 * and names and times are spelled the same through Temporal. Its engine's instants are checked against Date's in time.test.ts.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Cron } from 'croner'
import { croner } from '../../src/adapters/croner.ts'
import { chipWords, compile, describe, formatter, fromDateTarget, menu, nextRuns, status, TARGETS, upcoming } from '../../src/experimental/temporal/index.ts'
import { describe as describeDate, formatter as formatterDate, type Formatter } from '../../src/index.ts'

const values = ['0 9 * * 1-5', '*/15 * * * *', '30 2 * * *', '0 0 L * *', '0 9 * * 1#2', '45 23 31 * *', '0 */3 * * 0,6', '0 0 29 2 *']

const probe = (f: Formatter) => [
    f.time(0, 0),
    f.time(7, 5),
    f.time(19, 30),
    f.hour(0),
    f.hour(12),
    f.hour(17),
    f.month(3),
    f.month(9, 'short'),
    f.weekday(0),
    f.weekday(4, 'narrow'),
]

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
    for (const locale of ['en', 'en-GB', 'de', 'fr', 'ja', 'ko', 'zh', 'zh-u-nu-hanidec', 'ar', 'fa', 'he']) {
        for (const hourCycle of ['h11', 'h12', 'h23', 'h24'] as const) {
            assert.deepEqual(probe(formatter({ locale, hourCycle })), probe(formatterDate({ locale, hourCycle })), `${locale} ${hourCycle}`)
        }
    }

    for (const value of values) {
        assert.equal(describe(compile(value, TARGETS.croner), { locale: 'de' }), describeDate(compile(value, TARGETS.croner), { locale: 'de' }), value)
    }

    assert.equal(chipWords(compile('0 9-17 * * *', TARGETS.croner), { locale: 'de' }).hour, '09:00–17:00')
    assert.equal(menu('year', compile('0 0 1 1 ? *', TARGETS.eventbridge)).sections[0]?.presets[1]?.[1], String(Temporal.Now.plainDateISO().year))
})

test('the runtime still drops the hour padding the Temporal engine puts back', () => {
    const time = new Temporal.PlainTime(7, 5).toLocaleString('ja-u-hc-h23', { hour: '2-digit', minute: '2-digit' })

    // When this fails, the runtime pads the hour itself, and padHour in the Temporal entry can go.
    assert.equal(time, '7:05')
})

test('the runtime still ignores the hourCycle option for Temporal values, which the Temporal engine puts in the locale tag', () => {
    const midnight = new Temporal.PlainTime(0, 0).toLocaleString('ja', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' })

    // When this fails, the option works, and the engine can pass hourCycle as an option rather than as -u-hc- in the tag.
    assert.equal(midnight, '午前0:00')
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

test('upcoming returns a library’s runs in order, each once', () => {
    const target = fromDateTarget(croner(Cron))
    const runs = upcoming(target, '*/30 * * * *', { from: Temporal.Instant.from('2026-09-06T03:00:00Z'), count: 4, timezone: 'America/Santiago' })

    // Santiago skips midnight to 1:00, and croner runs the hour from 1:00 twice: once for midnight, once for itself. The repeats are asked for again.
    assert.deepEqual(
        runs.map(run => run.toInstant().toString()),
        ['2026-09-06T03:30:00Z', '2026-09-06T04:00:00Z', '2026-09-06T04:30:00Z', '2026-09-06T05:00:00Z'],
    )
})
