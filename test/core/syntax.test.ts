/*
 * Syntax: what each target refuses, the message and fix the field offers for it, shortcuts, and the tokens the menus
 * write back.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CronExpressionParser } from 'cron-parser'
import { Cron } from 'croner'
import { cronParser } from '../../src/adapters/cron-parser.ts'
import { croner } from '../../src/adapters/croner.ts'
import { compile, compress, describe, expand, messageFor, TARGETS, toggleDay, type TargetProfile } from '../../src/index.ts'

const c = (value: string, profile: TargetProfile = TARGETS.croner) => compile(value, profile)
const text = (value: string, profile?: TargetProfile) => messageFor(c(value, profile))?.text

test('rejects forms croner refuses or runs differently, and offers a fix where one exists', () => {
    const cases = [
        ['0 22-2 * * *', 'Hours: 22-2 runs backwards. Cron needs it split in two.', { hour: '22-23,0-2' }],
        // The step carries on across midnight: 10 PM, then 12 and 2 AM.
        ['0 22-2/2 * * *', 'Hours: 22-2 runs backwards. Cron needs it split in two.', { hour: '22,0-2/2' }],
        ['0 0 * 11-2/2 *', 'Months: 11-2 runs backwards. Cron needs it split in two.', { month: '11,1-2/2' }],
        ['5/15 * * * *', 'Minutes: 5/15 needs a range to step through: 5-59/15.', { minute: '5-59/15' }],
        ['0 0 * * 6-0', 'Day of week: Write Sunday as 7 at the end of a range.', { weekday: '6-7' }],
        ['0 0 1,LW * *', 'Day of month: LW has to be the whole field.', { day: 'LW' }],
        ['0 9 * * monday', 'Day of week: Cron only reads three-letter names. Use MON.', { weekday: 'MON' }],
        ['0 9 L-3 * *', 'Day of month: Counting back from the last day (L-3) isn’t supported. Use L, or list the days.', undefined],
        ['*/90 * * * *', 'Minutes: A step has to be 1 to 60.', undefined],
    ] as const

    for (const [value, expected, changes] of cases) {
        const message = messageFor(c(value))

        assert.equal(message?.bad, true, value)
        assert.equal(message?.text, expected, value)
        assert.deepEqual(message?.fix?.changes, changes, value)
    }
})

test('each target explains its own limits, with a fix where one exists', () => {
    const strict = cronParser(CronExpressionParser, { strict: true }).profile
    const cases: [TargetProfile, string, string, Record<string, string> | undefined][] = [
        [TARGETS['cron-parser'], '0 0 * * 1,5#2', 'Day of week: cron-parser needs 5#2 on its own, with nothing else in the field.', undefined],
        [TARGETS.eventbridge, '0 9 ? * 2,L *', 'Day of week: EventBridge needs L on its own, with nothing else in the field.', undefined],
        [TARGETS['cron-parser'], '0 0 1-10,5 * *', 'Day of month: 5 appears more than once. cron-parser allows each value only once.', undefined],
        [TARGETS.effect, '*/60 * * * *', 'Minutes: A step has to be 1 to 59.', undefined],
        // Effect reads 7 as Sunday in steps too, so */7 is Sundays alone and the longest weekday step.
        [TARGETS.effect, '0 0 * * */8', 'Day of week: A step has to be 1 to 7.', undefined],
        // A step from Sunday written as 7 is Sunday alone; croner with sloppyRanges accepts 7/2 but never runs it.
        [TARGETS.vixie, '0 0 * * 7/2', 'Day of week: 7/2 needs a range to step through: 7-7/2.', { weekday: '7-7/2' }],
        [croner(Cron, { sloppyRanges: true }).profile, '0 0 * * 7/2', 'Day of week: 7/2 needs a range to step through: 7-7/2.', { weekday: '7-7/2' }],
        // croner counts a year step on * from year 0.
        [croner(Cron, { parts: 7 }).profile, '0 0 0 1 1 * */2', 'Years: */2 needs a range to step through: 1-9999/2.', { year: '1-9999/2' }],
        // Strict cron-parser counts ? as a day field in use.
        [strict, '0 0 9 ? * 1', 'cron-parser can’t use both day fields. Set one to *.', { day: '*' }],
        [strict, '0 0 9 1 * 1', 'cron-parser can’t use both day fields. Set one to *.', { day: '*' }],
        [TARGETS.github, '0 9 abc * *', 'Day of month: “ABC” isn’t a day GitHub Actions understands.', undefined],
        [TARGETS.vixie, '0 9 * * mon/2', 'Day of week: MON/2 needs a range to step through: 1-6/2.', { weekday: '1-6/2' }],
        // W names one day: it can't end a range, and a target without W says so.
        [TARGETS.croner, '0 9 1-5W * *', 'Day of month: W works on one day, like 15W, not in a range or with a step.', undefined],
        [TARGETS.github, '0 9 1-5W * *', 'Day of month: GitHub Actions doesn’t support W.', undefined],
    ]

    for (const [profile, value, expected, changes] of cases) {
        const message = messageFor(c(value, profile))

        assert.equal(message?.text, expected, `${profile.name}: ${value}`)
        assert.deepEqual(message?.fix?.changes, changes, `${profile.name}: ${value}`)
    }
})

test('warns when a restricted day field still covers every day', () => {
    const message = messageFor(c('0 0 1-31 * 1'))

    // croner runs it when either field matches, so the weekday never narrows it.
    assert.equal(message?.bad, false)
    assert.equal(message?.text, '1-31 covers every day of the month, so the day of week field is ignored.')
    assert.deepEqual(message?.fix?.changes, { day: '*' })
    assert.equal(describe(c('0 0 1-31 * 1')), 'At 12:00 AM every day.')
})

test('accepts what a target runs differently than it reads, and warns with what it runs', () => {
    const cases: [TargetProfile, string, string, Record<string, string>, string][] = [
        // croner reads ? as every day, and either day field matching is enough.
        [
            TARGETS.croner,
            '0 9 ? * 1',
            'croner reads ? as every day, so the day of week field is ignored and this runs every day.',
            { day: '*' },
            'At 9:00 AM every day.',
        ],
        // cron-parser runs a step longer than the field at its start alone.
        [
            TARGETS['cron-parser'],
            '*/90 * * * *',
            'Minutes: A step of 90 is longer than the field, so cron-parser runs it only at 0.',
            { minute: '0' },
            'Every hour, on the hour.',
        ],
    ]

    for (const [profile, value, expected, changes, sentence] of cases) {
        const message = messageFor(c(value, profile))

        assert.deepEqual([message?.bad, message?.text, message?.fix?.changes, describe(c(value, profile))], [false, expected, changes, sentence], value)
    }

    // Where both day fields must match, ? reads as written.
    assert.equal(messageFor(c('0 9 ? * 1', croner(Cron, { domAndDow: true }).profile)), null)
})

test('reads the shortcuts a target knows, and tells an unknown shortcut from a wrong field count', () => {
    const croner6 = croner(Cron, { parts: 6 }).profile

    assert.deepEqual(expand(' @Daily ', TARGETS.croner), ['0', '0', '*', '*', '*'])
    assert.deepEqual(expand('@weekdays', TARGETS['cron-parser']), ['0', '0', '*', '*', '1-5'])

    for (const input of ['constructor', '__proto__', 'toString', '@never']) {
        assert.equal(expand(input, TARGETS.croner), null, input)
    }

    assert.equal(text('@daily extra'), 'croner needs 5 fields. This has 2.')
    assert.equal(text('0 9 * *'), 'croner needs 5 fields. This has 4.')
    assert.equal(text('@nope'), '@nope isn’t a cron shortcut. Try @daily or @hourly.')
    assert.equal(text(''), 'Type a schedule, like 0 9 * * 1-5.')
    // cron-parser reads shortcuts in lower case only; croner in any case, and not at all with six or seven fields.
    assert.equal(text('@DAILY', TARGETS['cron-parser']), '@DAILY isn’t a cron shortcut. Try @daily or @hourly.')
    assert.equal(text('@DAILY'), undefined)
    assert.equal(text('@daily', croner6), 'croner doesn’t read shortcuts like @daily.')
})

test('writes value sets back as the shortest token the target reads', () => {
    assert.equal(compress([0, 15, 30, 45], 'minute', TARGETS.croner), '*/15')
    assert.equal(compress([5, 20, 35, 50], 'minute', TARGETS.croner), '5-59/15')
    // Effect and the others with a start-and-step form take it as written.
    assert.equal(compress([5, 20, 35, 50], 'minute', TARGETS.effect), '5/15')
    assert.equal(compress([1, 2, 3, 4, 5], 'weekday', TARGETS.croner), '1-5')
    assert.equal(compress([1, 3, 5], 'weekday', TARGETS.croner, false), '1,3,5')
    assert.equal(compress([0, 6], 'weekday', TARGETS.cloudflare, false), '1,7')
    assert.deepEqual(toggleDay(c('0 9 * * 1-5'), 5), { weekday: '1-4' })
    assert.deepEqual(toggleDay(c('0 9 * * 1'), 1), { weekday: '*' })
})
