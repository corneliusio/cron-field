/*
 * Tests against the croner target: the package must keep the field's
 * behavior for the target it was built for.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Cron } from 'croner'
import { croner } from '../src/adapters/croner.ts'
import { chipWords, compile, compress, describe, expand, messageFor, status, toggleDay, upcoming } from '../src/index.ts'

const target = croner(Cron, { timezone: 'UTC' })
const c = (value: string) => compile(value, target.profile)
const valid = (value: string) => status(value, c(value), target).valid
const days = (value: string, start: string, end: string) =>
    upcoming(target, value, { from: new Date(new Date(start).getTime() - 1), count: 400 })
        .filter(date => date < new Date(end))
        .map(date => date.toISOString().slice(0, 10))

test('accepts the extended syntax croner runs', () => {
    for (const value of ['0 9 L * *', '0 9 LW * *', '0 9 15W * *', '0 9 1,L * *', '0 9 * * 1#1', '0 9 * * 5L', '0 9 * JAN-MAR MON-FRI', '0 0 * * 7']) {
        assert.equal(valid(value), true, value)
    }
})

test('rejects forms croner refuses or runs differently, and offers a fix where one exists', () => {
    const cases = [
        ['0 22-2 * * *', 'Hours: 22-2 runs backwards. Cron needs it split in two.', { hour: '22-23,0-2' }],
        // The step carries on across midnight: 10 PM, then 12 and 2 AM.
        ['0 22-2/2 * * *', 'Hours: 22-2 runs backwards. Cron needs it split in two.', { hour: '22,0-2/2' }],
        ['0 0 * 11-2/2 *', 'Months: 11-2 runs backwards. Cron needs it split in two.', { month: '11,1-2/2' }],
        ['5/15 * * * *', 'Minutes: 5/15 needs a range to step through: 5-59/15.', { minute: '5-59/15' }],
        ['0 0 * * 6-0', 'Day of week: Write Sunday as 7 at the end of a range.', { weekday: '6-7' }],
        ['0 9 ? * 1', 'Day of month: Use * here.', { day: '*' }],
        ['0 0 1,LW * *', 'Day of month: LW has to be the whole field.', { day: 'LW' }],
        ['0 9 * * monday', 'Day of week: Cron only reads three-letter names. Use MON.', { weekday: 'MON' }],
        ['0 9 L-3 * *', 'Day of month: Counting back from the last day (L-3) isn’t supported. Use L, or list the days.', undefined],
        ['*/90 * * * *', 'Minutes: A step has to be 1 to 60.', undefined],
    ] as const

    for (const [value, text, changes] of cases) {
        const message = messageFor(c(value))

        assert.equal(valid(value), false, value)
        assert.equal(message?.text, text, value)
        assert.deepEqual(message?.fix?.changes, changes, value)
    }
})

test('describes day fields with croner’s OR, which applies unless one of them is exactly *', () => {
    assert.equal(describe(c('0 0 */2 * 1')), 'At 12:00 AM every other day of the month, or on Mondays.')
    // Saturday the 3rd matches the odd days, Monday the 12th matches the weekday.
    assert.deepEqual(days('0 0 */2 * 1', '2026-01-02T12:00:00Z', '2026-01-13T00:00:00Z'), [
        '2026-01-03',
        '2026-01-05',
        '2026-01-07',
        '2026-01-09',
        '2026-01-11',
        '2026-01-12',
    ])

    const words = chipWords(c('0 9 1 * 1-5'))

    assert.deepEqual([words.day, words.month, words.weekday], ['On the 1st, or weekdays', null, 'Weekdays, or on the 1st'])
})

test('warns when a restricted day field still covers every day', () => {
    const message = messageFor(c('0 0 1-31 * 1'))

    assert.equal(describe(c('0 0 1-31 * 1')), 'At 12:00 AM every day.')
    assert.equal(message?.bad, false)
    assert.deepEqual(message?.fix?.changes, { day: '*' })
    // Thursday to Saturday: no Monday among them, yet it runs on each.
    assert.deepEqual(days('0 0 1-31 * 1', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z'), ['2026-01-01', '2026-01-02', '2026-01-03'])
})

test('describes common and extended schedules in one sentence', () => {
    const cases = [
        ['30 7 * * 1-5', 'At 7:30 AM on weekdays.'],
        ['0 9,17 * * *', 'At 9:00 AM and 5:00 PM every day.'],
        ['15 8 * * 1,3,5', 'At 8:15 AM on Mondays, Wednesdays, and Fridays.'],
        ['5-59/15 * * * *', 'Every 15 minutes (:05, :20, :35, :50).'],
        ['0 9 LW * *', 'At 9:00 AM on the last weekday of the month.'],
        ['0 9 * * 1#1', 'At 9:00 AM on the first Monday of the month.'],
        ['0 9 1,15 */3 *', 'At 9:00 AM on the 1st and 15th of January, April, July, and October.'],
        ['0 9 * JAN-MAR MON-FRI', 'At 9:00 AM on weekdays in January through March.'],
        // The months apply to both day choices, so they come after the second.
        ['0 9 1 JAN-MAR 1', 'At 9:00 AM on the 1st, or on Mondays, in January through March.'],
    ]

    for (const [value = '', sentence] of cases) {
        assert.equal(describe(c(value)), sentence, value)
    }
})

test('says when minutes stop before the hour ends', () => {
    const cases = [
        ['0-20/2 * * * *', 'Every 2 minutes from :00 to :20, every hour.'],
        ['10-40/5 9-17 * * 1-5', 'Every 5 minutes from :10 to :40, during the 9 AM–5 PM hours, on weekdays.'],
        ['10-40 9 * * *', 'Every minute from :10 to :40, during the 9 AM hour.'],
        ['5-59/2 * * * *', 'Every 2 minutes, starting at :05.'],
        ['*/15 9-17 * * 1-5', 'Every 15 minutes (:00, :15, :30, :45), from 9:00 AM to 5:45 PM, on weekdays.'],
    ]

    for (const [value = '', sentence] of cases) {
        assert.equal(describe(c(value)), sentence, value)
    }

    // croner stops each hour at :20 and resumes on the hour.
    assert.deepEqual(
        upcoming(target, '0-20/2 * * * *', { from: new Date('2026-01-01T00:15:00Z'), count: 5 }).map(date => date.toISOString().slice(11, 16)),
        ['00:16', '00:18', '00:20', '01:00', '01:02'],
    )
})

test('expands only real macros', () => {
    assert.deepEqual(expand(' @Daily ', target.profile), ['0', '0', '*', '*', '*'])

    for (const input of ['constructor', '__proto__', 'toString', '@never']) {
        assert.equal(expand(input, target.profile), null, input)
    }
})

test('writes value sets back as the shortest token croner accepts', () => {
    assert.equal(compress([0, 15, 30, 45], 'minute', target.profile), '*/15')
    assert.equal(compress([5, 20, 35, 50], 'minute', target.profile), '5-59/15')
    assert.equal(compress([1, 2, 3, 4, 5], 'weekday', target.profile), '1-5')
    assert.equal(compress([1, 3, 5], 'weekday', target.profile, false), '1,3,5')
    assert.deepEqual(toggleDay(c('0 9 * * 1-5'), 5), { weekday: '1-4' })
    assert.deepEqual(toggleDay(c('0 9 * * 1'), 1), { weekday: '*' })
})

test('reports what croner itself refuses', () => {
    assert.equal(target.validate?.('0 0 0 0 0 0 0').ok, false)
    assert.equal(valid('0 0 31 2 *'), false)
    assert.equal(status('0 0 31 2 *', c('0 0 31 2 *'), target).message?.text, 'February never has a 31st.')
})
