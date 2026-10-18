/*
 * Describing a schedule: the sentence under the field and the words on each chip, which follow the target's rules for
 * days, ranges and steps.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Cron } from 'croner'
import { croner } from '../../src/adapters/croner.ts'
import { chipWords, compile, describe, TARGETS, type TargetProfile } from '../../src/index.ts'

const c = (value: string, profile: TargetProfile = TARGETS.croner) => compile(value, profile)

test('describes common and extended schedules in one sentence', () => {
    const cases = [
        ['30 7 * * 1-5', 'At 7:30 AM on weekdays.'],
        ['0 9,17 * * *', 'At 9:00 AM and 5:00 PM every day.'],
        ['15 8 * * 1,3,5', 'At 8:15 AM on Mondays, Wednesdays, and Fridays.'],
        ['5-59/15 * * * *', 'Every 15 minutes (:05, :20, :35, :50).'],
        ['0 9 LW * *', 'At 9:00 AM on the last weekday of the month.'],
        ['0 9 1W * *', 'At 9:00 AM on the weekday nearest the 1st of the month.'],
        ['0 9 * * 1#1', 'At 9:00 AM on the first Monday of the month.'],
        ['0 9 * * 5#L', 'At 9:00 AM on the last Friday of the month.'],
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
})

test('describes day fields with croner’s OR, which applies unless one of them is exactly *', () => {
    const words = chipWords(c('0 9 1 * 1-5'))

    assert.equal(describe(c('0 0 */2 * 1')), 'At 12:00 AM every other day of the month, or on Mondays.')
    assert.deepEqual([words.day, words.month, words.weekday], ['On the 1st, or weekdays', null, 'Weekdays, or on the 1st'])
})

test('a field that covers every value reads as unrestricted, whatever it adds', () => {
    assert.equal(chipWords(c('0 9 * * *,1#1')).weekday, null)
    assert.equal(chipWords(c('0 9 1-31,L * *')).day, null)
    assert.equal(chipWords(c('0 9 L * *')).day, 'Last day')
    assert.equal(describe(c('0 9 * * *,1#1')), 'At 9:00 AM every day.')
    assert.equal(describe(c('0 9 1-31,L * *')), 'At 9:00 AM every day.')
    // Either may match, so the day of month runs it every day; when both must match, only Mondays.
    assert.equal(describe(c('0 9 1-31,L * 1')), 'At 9:00 AM every day.')
    assert.equal(describe(c('0 9 1-31,L * 1', croner(Cron, { domAndDow: true }).profile)), 'At 9:00 AM on Mondays.')
})

test('a range past the field’s end reads as one range, in the sentence and on the chip', () => {
    const weekdays = c('0 0 9 ? * 6-2', TARGETS.quartz)

    assert.deepEqual([...(weekdays.parsed.weekday?.set ?? [])].sort(), [0, 1, 5, 6])
    assert.equal(describe(weekdays), 'At 9:00 AM, Friday through Monday.')
    assert.equal(chipWords(weekdays).weekday, 'Friday through Monday')
    assert.equal(describe(c('0 0 22-2 ? * 2', TARGETS.quartz)), 'At 12:00 AM, 1:00 AM, 2:00 AM, 10:00 PM, and 11:00 PM on Mondays.')
    // Minutes that wrap run on into the next hour only when every hour runs.
    assert.equal(describe(c('0 50-10 * ? * *', TARGETS.quartz)), 'Every minute from :50 to :10, every hour.')
})

test('days counted back from the last day read as the nth-to-last', () => {
    assert.equal(describe(c('0 0 22 L-3 * ?', TARGETS.quartz)), 'At 10:00 PM on the 4th-to-last day of the month.')
    assert.equal(chipWords(c('0 0 22 L-1 * ?', TARGETS.quartz)).day, '2nd-to-last day')
})

test('a weekday step from a start reaches Sunday only where 7 is Sunday', () => {
    const sunday = 'At 12:00 AM on Sundays, Mondays, Wednesdays, and Fridays.'

    // cron-parser and Effect run 1/2 as 1, 3, 5 and 7; GitHub reads weekdays 0 to 6.
    assert.equal(describe(c('0 0 * * 1/2', TARGETS['cron-parser'])), sunday)
    assert.equal(describe(c('0 0 * * 1/2', TARGETS.effect)), sunday)
    assert.equal(chipWords(c('0 0 * * 1/2', TARGETS.effect)).weekday, 'Sundays, Mondays, Wednesdays, and Fridays')
    assert.equal(describe(c('0 0 * * 1/2', TARGETS.github)), 'At 12:00 AM on Mondays, Wednesdays, and Fridays.')
})

test('seconds, years and the time zone frame the sentence', () => {
    const croner6 = croner(Cron, { parts: 6 }).profile
    const croner7 = croner(Cron, { parts: 7 }).profile

    assert.equal(describe(c('*/10 0 9 * * *', croner6)), 'Every 10 seconds, at 9:00 AM every day.')
    // One second joins an exact time; seconds that run every minute or in stepped minutes don't repeat the minute's cadence.
    assert.equal(describe(c('30 0 9 * * *', croner6)), 'At 9:00:30 AM every day.')
    assert.equal(describe(c('*/10 * * * * *', croner6)), 'Every 10 seconds.')
    assert.equal(describe(c('*/10 * 9 * * 1', croner6)), 'Every 10 seconds, during the 9 AM hour, on Mondays.')
    assert.equal(describe(c('*/10 */5 * * * *', croner6)), 'Every 10 seconds, in every 5th minute.')
    assert.equal(describe(c('1 * * * * *', croner6)), 'At 1 second past every minute.')
    assert.equal(describe(c('15 */2 * * * *', croner6)), 'At 15 seconds past the minute, every 2 minutes.')
    assert.equal(describe(c('0 0 0 1 1 * 2030-2032', croner7)), 'At 12:00 AM on the 1st of January, in 2030 through 2032.')
    assert.equal(chipWords(c('0 0 0 1 1 * 2030-2032', croner7)).year, '2030–2032')
    assert.equal(describe(c('0 9 * * 1-5'), { timezone: 'Europe/Berlin' }), 'At 9:00 AM on weekdays (Europe/Berlin).')
})
