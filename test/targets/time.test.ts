/*
 * Time: wall-clock schedules across DST gaps and repeats, offsets that aren't whole hours, years and leap days, on both
 * engines, and a library's runs put in order.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Cron } from 'croner'
import { croner } from '../../src/adapters/croner.ts'
import { dateEngine, type Engine } from '../../src/core/engine.ts'
import { matchRuns } from '../../src/core/schedule.ts'
import { temporalEngine } from '../../src/experimental/temporal/index.ts'
import { compile, nextRuns, resolveTarget, status, TARGETS, upcoming, type Target } from '../../src/index.ts'

const ENGINES: [string, Engine][] = [
    ['Date', dateEngine],
    ['Temporal', temporalEngine],
]
// Each zone's 2026 DST changes, as instants.
const ZONES: Record<string, string[]> = {
    'UTC': [],
    // A 1-hour gap at 2:00 and a repeat from 1:00.
    'America/Chicago': ['2026-03-08T08:00:00Z', '2026-11-01T07:00:00Z'],
    // 30-minute changes, in the southern hemisphere: 2:00 back to 1:30 in April, 2:00 on to 2:30 in October.
    'Australia/Lord_Howe': ['2026-04-04T15:00:00Z', '2026-10-03T15:30:00Z'],
    // Midnight goes back to 23:00 in April, and midnight doesn't exist in September.
    'America/Santiago': ['2026-04-05T03:00:00Z', '2026-09-06T04:00:00Z'],
    // +12:45 and +13:45, so the local date is a day ahead of UTC's for most of it.
    'Pacific/Chatham': ['2026-04-04T14:00:00Z', '2026-09-26T14:00:00Z'],
}
const VALUES = ['30 2 * * *', '30 1 * * *', '0,20,40 2 * * *', '45 1 * * *', '0 0 * * *', '30 23 * * *', '*/15 * * * *', '0 0 L * *']
const HOUR = 3_600_000

const runs = (value: string, timezone: string | undefined, from: string, count: number, engine: Engine, target = TARGETS.croner) =>
    matchRuns(compile(value, target), { from: Date.parse(from), count, timezone }, engine).map(time => new Date(time).toISOString())
const fixedNow = (iso: string): Engine => ({ ...dateEngine, now: () => Date.parse(iso) })

test('the Date and Temporal engines give the same runs, through every DST change', () => {
    for (const [timezone, changes] of Object.entries(ZONES)) {
        // An hour before each change, and a day with no change.
        const starts = [...changes.map(change => new Date(Date.parse(change) - HOUR).toISOString()), '2026-06-15T00:00:00Z']

        for (const value of VALUES) {
            for (const from of starts) {
                assert.deepEqual(
                    runs(value, timezone, from, 6, temporalEngine),
                    runs(value, timezone, from, 6, dateEngine),
                    `${value} in ${timezone} from ${from}`,
                )
            }
        }
    }
})

test('a time a DST change skips moves forward by the gap, a repeated one runs once at its first, and runs stay in order', () => {
    const anchors: [value: string, timezone: string, from: string, expected: string[]][] = [
        // 2:30 doesn't exist on the day Chicago springs forward; 3:00 does, as 3:00 CDT.
        ['30 2 * * *', 'America/Chicago', '2026-03-08T07:00:00Z', ['2026-03-08T08:30:00.000Z']],
        ['0 3 * * *', 'America/Chicago', '2026-03-08T07:59:00Z', ['2026-03-08T08:00:00.000Z']],
        // 1:30 happens twice when Chicago falls back.
        ['30 1 * * *', 'America/Chicago', '2026-11-01T05:00:00Z', ['2026-11-01T06:30:00.000Z', '2026-11-02T07:30:00.000Z']],
        // Lord Howe skips 2:00 to 2:30: 2:00 and 2:20 move to 2:30 and 2:50, around 2:40.
        [
            '0,20,40 2 * * *',
            'Australia/Lord_Howe',
            '2026-10-03T15:20:00Z',
            ['2026-10-03T15:30:00.000Z', '2026-10-03T15:40:00.000Z', '2026-10-03T15:50:00.000Z'],
        ],
        ['0,20,40 2 * * *', 'Australia/Lord_Howe', '2026-10-03T15:35:00Z', ['2026-10-03T15:40:00.000Z']],
        // Lord Howe repeats 1:30 to 2:00, half an hour.
        ['45 1 * * *', 'Australia/Lord_Howe', '2026-04-04T14:00:00Z', ['2026-04-04T14:45:00.000Z', '2026-04-05T15:15:00.000Z']],
        // Santiago has no midnight in September, so the day's midnight run is at 1:00.
        ['0 0 * * *', 'America/Santiago', '2026-09-05T12:00:00Z', ['2026-09-06T04:00:00.000Z', '2026-09-07T03:00:00.000Z']],
        // Santiago repeats 23:00 to midnight in April.
        ['30 23 * * *', 'America/Santiago', '2026-04-04T12:00:00Z', ['2026-04-05T02:30:00.000Z', '2026-04-06T03:30:00.000Z']],
        // 9:00 on June 16th in Chatham is still June 15th in UTC.
        ['0 9 * * *', 'Pacific/Chatham', '2026-06-15T00:00:00Z', ['2026-06-15T20:15:00.000Z']],
    ]

    for (const [name, engine] of ENGINES) {
        for (const [value, timezone, from, expected] of anchors) {
            assert.deepEqual(runs(value, timezone, from, expected.length, engine), expected, `${name}: ${value} in ${timezone} from ${from}`)
        }
    }
})

test('upcoming puts croner’s runs in order and each once, and still returns as many as asked', () => {
    const target = croner(Cron)
    const times = (value: string, timezone: string, from: string, count: number) =>
        upcoming(target, value, { from: new Date(from), count, timezone }).map(date => date.toISOString().slice(11, 16))

    // croner returns 2:50 before 2:40 in Lord Howe's gap.
    assert.deepEqual(times('0,20,40 2 * * *', 'Australia/Lord_Howe', '2026-10-03T15:20:00Z', 3), ['15:30', '15:40', '15:50'])
    // croner runs Santiago's missing midnight hour at 1:00 and then 1:00 again; the repeats are asked for again.
    assert.deepEqual(times('*/30 * * * *', 'America/Santiago', '2026-09-06T03:00:00Z', 4), ['03:30', '04:00', '04:30', '05:00'])
})

test('years follow the target, and a schedule whose years have all passed says so', () => {
    const eventbridge = resolveTarget('eventbridge')
    const croner7 = croner(Cron, { parts: 7, timezone: 'UTC' })
    const text = (target: Target, value: string) =>
        status(value, compile(value, target.profile), target, { engine: fixedNow('2026-06-15T00:00:00Z') }).message?.text

    // EventBridge runs 1970 to 2199; croner, years 1 to 9999.
    assert.equal(compile('0 0 1 1 ? 2200', eventbridge.profile).ok, false)
    assert.deepEqual(nextRuns(compile('0 0 * * ? *', eventbridge.profile), { from: new Date('2199-12-31T23:59:59Z') }), [])
    assert.deepEqual(upcoming(croner7, '0 0 0 1 1 * 2200', { from: new Date('2026-06-15T00:00:00Z') }), [new Date('2200-01-01T00:00:00Z')])
    assert.equal(text(eventbridge, '0 0 1 1 ? 2020'), 'This schedule won’t run again: 2020 has passed.')
    assert.equal(text(eventbridge, '0 0 1 1 ? 2019-2021'), 'This schedule won’t run again: its last year, 2021, has passed.')
})

test('leap days skip the years that have none, and a day no month has says so', () => {
    const both = croner(Cron, { domAndDow: true }).profile
    const vixie = resolveTarget('vixie')
    const text = (value: string) => status(value, compile(value, vixie.profile), vixie, { engine: fixedNow('2026-06-15T00:00:00Z') }).message?.text

    for (const [name, engine] of ENGINES) {
        // 2100 is not a leap year.
        assert.deepEqual(runs('0 0 29 2 *', 'UTC', '2096-03-01T00:00:00Z', 1, engine), ['2104-02-29T00:00:00.000Z'], name)
        // February 29th next falls on a Monday in 2044.
        assert.deepEqual(runs('0 0 29 2 1', 'UTC', '2026-03-01T00:00:00Z', 1, engine, both), ['2044-02-29T00:00:00.000Z'], name)
    }

    assert.equal(text('0 9 31 2 *'), 'February never has a 31st.')
    assert.equal(text('0 0 31 4,6,9,11 *'), 'April, June, September, and November never have a 31st.')
})

test('without a time zone, both engines use the runtime’s', () => {
    // The test script sets TZ.
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/Chicago')

    for (const [name, engine] of ENGINES) {
        for (const value of ['30 2 * * *', '*/15 * * * *']) {
            assert.deepEqual(
                runs(value, undefined, '2026-03-08T07:00:00Z', 4, engine),
                runs(value, 'America/Chicago', '2026-03-08T07:00:00Z', 4, engine),
                `${name}: ${value}`,
            )
        }
    }
})
