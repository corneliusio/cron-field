/*
 * Locales: Intl formats times, names, lists and the week; the sentence and chip labels are built only from
 * catalog messages, so a translation reaches every word.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { chipWords, compile, describe, formatMessage, formatter, menu, MESSAGES, TARGETS, type Translate } from '../../src/index.ts'

const c = (value: string) => compile(value, TARGETS.croner)

test('a locale sets the clock, the names and the week', () => {
    const de = formatter({ locale: 'de' })

    assert.equal(de.hourCycle, 'h23')
    assert.equal(de.time(17, 5), '17:05')
    assert.equal(de.month(3), 'März')
    assert.deepEqual(de.weekOrder, [1, 2, 3, 4, 5, 6, 0])
    assert.deepEqual(de.weekOrder.map(d => de.weekday(d, 'narrow')).join(''), 'MDMDFSS')
    assert.equal(formatter({ locale: 'en-US' }).weekOrder[0], 0)
    // Without a locale the week starts on Monday, as the field was designed, and the clock is 12-hour.
    assert.equal(formatter().weekOrder[0], 1)
    assert.equal(formatter().hourCycle, 'h12')
    assert.equal(formatter({ locale: 'de', hourCycle: 'h12', weekStart: 0 }).weekOrder[0], 0)
})

test('hourCycle sets the clock in times, the sentence, chip labels and presets', () => {
    const at = (hourCycle: 'h11' | 'h12' | 'h23' | 'h24') => formatter({ hourCycle })

    assert.deepEqual([at('h12').time(0, 5), at('h11').time(0, 5), at('h23').time(0, 5), at('h24').time(0, 5)], ['12:05 AM', '0:05 AM', '00:05', '24:05'])
    assert.deepEqual([at('h12').hour(17), at('h11').hour(17), at('h23').hour(17), at('h24').hour(17)], ['5 PM', '5 PM', '17:00', '17:00'])
    assert.equal(describe(c('30 7,19 * * 1-5'), { hourCycle: 'h23' }), 'At 07:30 and 19:30 on weekdays.')
    assert.equal(describe(c('0 9-17 * * *'), { hourCycle: 'h23' }), 'Every hour, on the hour, from 09:00 to 17:00.')
    assert.equal(chipWords(c('0 9-17 * * *'), { hourCycle: 'h23' }).hour, '09:00–17:00')
    assert.deepEqual(
        menu('hour', c('0 9 * * *'), { hourCycle: 'h23' }).sections[0]?.presets.map(([label]) => label),
        ['Every hour', '09:00–17:00', 'Every other hour', 'At 09:00'],
    )
    // Without the option, nothing changes.
    assert.equal(describe(c('30 7 * * 1-5')), 'At 7:30 AM on weekdays.')
})

test('Intl formats the values inside English messages', () => {
    assert.equal(chipWords(c('0 9-17 * * *'), { locale: 'de' }).hour, '09:00–17:00')
    assert.equal(describe(c('30 7 * 3 *'), { locale: 'en-GB' }), 'At 07:30 every day in March.')
    assert.equal(describe(c('15 8 * * 1,3,5'), { locale: 'en-GB', hourCycle: 'h12' }), 'At 8:15 am on Mondays, Wednesdays and Fridays.')
    assert.deepEqual(
        menu('month', c('0 9 * * *'), { locale: 'fr' }).sections[0]?.presets.map(([label]) => label),
        ['Every month', 'Quarterly: starting janv.', 'Quarterly: starting févr.', 'Quarterly: starting mars'],
    )
})

test('the sentence and chip labels use no words outside the catalog', () => {
    // Every message becomes a number and its params, so any English left would come from code rather than the catalog.
    const keys = Object.keys(MESSAGES)
    // Keys that only feed `select`, such as field: minute, are values rather than words.
    const selectKeys = new Set(['field', 'other', 'parity', 'join', 'hasFrom', 'hasUntil', 'names'])
    const ids: Translate = ({ id, params }) =>
        `m${keys.indexOf(id)}(${Object.entries(params)
            .filter(([key]) => !selectKeys.has(key))
            .map(([, value]) => value)
            .join('|')})`
    const english = /\b(every|at|on|the|of|and|or|in|during|from|to|past|hours?|minutes?|days?|weekdays|but|only)\b/i
    const values = ['*/15 9-17 1 */3 1-5', '0 9 LW * *', '0 9 * * 1#1', '5-59/15 * * JAN-MAR MON-FRI', '0 0 */2 * 1', '0 22 L-3 * *', '30 6 1,15 * *']

    for (const value of values) {
        const compiled = compile(value, TARGETS.croner)
        const sentence = describe(compiled, { locale: 'de', translate: ids }) ?? ''
        const words = Object.values(chipWords(compiled, { locale: 'de', translate: ids })).join(' ')

        assert.doesNotMatch(sentence, english, `${value}: ${sentence}`)
        assert.doesNotMatch(words, english, `${value}: ${words}`)
    }
})

test('a translation reaches the whole sentence', () => {
    // A small German catalog; the rest falls back to English.
    const german: Partial<Record<keyof typeof MESSAGES, string>> = {
        'sentence.days': '{time} {days}',
        'time.at': 'Um {times}',
        'dow.weekdays': 'an Wochentagen',
        'dow.on': 'am {days}',
        'day.plural': '{dayName}',
        'word.weekdays': 'werktags',
    }
    const translate: Translate = ({ id, template, params }) => formatMessage(german[id] ?? template, params, 'de')

    assert.equal(describe(c('0 9 * * 1-5'), { locale: 'de', translate }), 'Um 09:00 an Wochentagen.')
    assert.equal(describe(c('30 8 * * 1,3'), { locale: 'de', translate }), 'Um 08:30 am Montag und Mittwoch.')
    assert.equal(chipWords(c('0 9 * * 1-5'), { locale: 'de', translate }).weekday, 'Werktags')
})

test('month names are Gregorian whatever calendar the locale uses', () => {
    const march = new Intl.DateTimeFormat('fa', { month: 'long', calendar: 'gregory', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, 2, 1)))

    assert.equal(formatter({ locale: 'fa' }).month(3), march)
})
