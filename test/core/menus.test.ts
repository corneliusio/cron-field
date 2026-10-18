/*
 * The chips' menus: which presets and occurrence rules each target offers, how the day chips share a menu, custom
 * presets, and the values picking one writes.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CronExpressionParser } from 'cron-parser'
import { cronParser } from '../../src/adapters/cron-parser.ts'
import { applyChanges, compile, daysNote, isCurrent, menu, menuOf, nthOptions, nthToken, TARGETS, type TargetName } from '../../src/index.ts'

const labels = (name: TargetName) => menu('days', compile('0 9 * * *', TARGETS[name])).sections.flatMap(section => section.presets.map(([label]) => label))

test('presets and occurrence rules follow what the target reads', () => {
    assert.ok(labels('croner').includes('Last weekday'))
    assert.ok(!labels('cron-parser').includes('Last weekday'))
    assert.ok(labels('cron-parser').includes('Last Friday'))
    assert.ok(!labels('effect').includes('First Monday'))
    // GitHub writes a step from a start, as its docs do.
    assert.deepEqual(
        menu('minute', compile('0 9 * * *', TARGETS.github)).sections[0]?.presets.map(([, token]) => token),
        ['*', '0/5', '0/10', '0/15', '0/30', '0'],
    )
    assert.deepEqual(
        menu('year', compile('0 0 1 1 ? *', TARGETS.eventbridge), { year: 2026 }).sections[0]?.presets.map(([, token]) => token),
        ['*', '2026', '2027'],
    )
    assert.deepEqual(
        nthOptions(TARGETS.croner).map(([k]) => k),
        ['1', '2', '3', '4', '5', 'L'],
    )
    assert.deepEqual(nthOptions(TARGETS.effect), [])
    // The last Friday and the second Monday, where Sunday is 1.
    assert.deepEqual([nthToken('L', 5, TARGETS.cloudflare), nthToken('2', 1, TARGETS.quartz)], ['6L', '2#2'])
})

test('day chips share the Days menu only where the target reads occurrence rules, which stay out of the weekday menu', () => {
    const vixie = menu('weekday', compile('0 9 * * 1-5', TARGETS.vixie))
    const croner = menu('weekday', compile('0 9 * * *', TARGETS.croner))

    assert.equal(menuOf('day', TARGETS.croner), 'days')
    assert.equal(menuOf('weekday', TARGETS.croner), 'days')
    assert.equal(menuOf('day', TARGETS.vixie), 'day')
    assert.equal(menuOf('weekday', TARGETS.github), 'weekday')
    assert.equal(vixie.title, 'Day of week')
    assert.deepEqual(
        vixie.sections.map(section => [section.field, section.control]),
        [['weekday', 'days']],
    )
    assert.deepEqual(
        croner.sections.flatMap(section => section.presets.map(([label]) => label)),
        ['Every day', 'Weekdays', 'Weekends'],
    )
})

test('presets can be replaced or extended per field, and take the chip’s words', () => {
    const c = compile('0 9 * * *', TARGETS.vercel)
    const read = (key: 'hour' | 'days', presets: Parameters<typeof menu>[2]) =>
        menu(key, c, presets).sections.map(section => section.presets.map(([label, token]) => `${label} ${token}`))

    assert.deepEqual(read('hour', { presets: { hour: ['*', '8-18', '12'] } }), [['Every hour *', '8 AM–6 PM 8-18', 'At 12 PM 12']])
    // A preset can bring its own label; one the target can't read still drops out.
    assert.deepEqual(
        read('hour', {
            presets: {
                hour: [
                    { token: '8-18', label: 'Business hours' },
                    { token: '25', label: 'Never' },
                ],
            },
        }),
        [['Business hours 8-18']],
    )
    // A function extends the defaults; tokens the target can't read, such as L on Vercel, drop out.
    assert.deepEqual(read('days', { presets: { day: defaults => [...defaults, 'L', '10-20'], weekday: ['1,3,5'] } }), [
        ['Every day *', 'On the 1st 1', 'On the 1st and 15th 1,15', 'On the 10th–20th 10-20'],
        ['Mondays, Wednesdays, and Fridays 1,3,5'],
    ])
    // Occurrence tokens go into their own section.
    assert.deepEqual(
        menu('days', compile('0 9 * * *', TARGETS.croner), { presets: { weekday: ['1-5', '2#3'] } }).sections.map(section =>
            section.presets.map(([label]) => label),
        ),
        [['Every day', 'On the 1st', 'On the 1st and 15th', 'Last day', 'Last weekday', 'Weekday nearest the 15th'], ['Third Tuesday'], ['Weekdays']],
    )
})

test('a change to a value that doesn’t parse starts from a schedule on the hour', () => {
    assert.equal(applyChanges('0 9', { hour: '9' }, TARGETS.croner), '0 9 * * *')
    assert.equal(applyChanges('', { weekday: '2-6' }, TARGETS.quartz), '0 0 * ? * 2-6')
})

test('? is the * preset only where it means the same, and clears the other day field where it counts as set', () => {
    const strict = cronParser(CronExpressionParser, { strict: true }).profile

    assert.equal(isCurrent(compile('0 0 9 ? * *', TARGETS.quartz), 'day', '*'), true)
    // croner reads ? as every day, set, so * would change what runs.
    assert.equal(isCurrent(compile('0 9 ? * 1', TARGETS.croner), 'day', '*'), false)
    assert.equal(applyChanges('0 0 9 * * 1', { day: '?' }, strict), '0 0 9 ? * *')
    assert.equal(applyChanges('0 0 9 ? * 1', { day: '?' }, TARGETS.quartz), '0 0 9 ? * 1')
})

test('the Days menu says how the two day fields combine', () => {
    const note = (name: TargetName, value: string) => daysNote(compile(value, TARGETS[name]))

    assert.equal(note('croner', '0 0 3 * 1'), 'Both day fields are set, so it runs when either one matches.')
    assert.equal(note('vixie', '0 0 */2 * 1'), 'Both day fields are set, so it runs only when both match.')
    assert.equal(note('vercel', '0 0 * * 1'), 'Vercel uses one day field at a time. Setting one clears the other.')
    assert.equal(note('croner', '0 0 * * 1'), null)
})
