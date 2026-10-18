/*
 * Target profiles: each target parses, writes and combines days its own way, and the built-in matcher
 * runs schedules by those rules.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CronExpressionParser } from 'cron-parser'
import { Cron as EffectCron } from 'effect'
import { cronParser } from '../src/adapters/cron-parser.ts'
import { effect } from '../src/adapters/effect.ts'
import { applyChanges, compile, describe, menu, messageFor, nextRuns, resolveTarget, status, TARGETS, type TargetName } from '../src/index.ts'

const from = new Date('2026-01-02T12:00:00Z')
const days = (name: TargetName, value: string, count = 6) =>
    nextRuns(compile(value, TARGETS[name]), { from, count, timezone: 'UTC' }).map(date => date.toISOString().slice(0, 10))
const presets = (name: TargetName) => menu('days', compile('0 9 * * *', TARGETS[name])).sections.flatMap(section => section.presets.map(([label]) => label))

test('Vixie cron requires both day fields when one starts with *', () => {
    // Odd days that are Mondays: the 5th of January, then the 19th.
    assert.deepEqual(days('vixie', '0 0 */2 * 1', 2), ['2026-01-05', '2026-01-19'])
    assert.equal(
        describe(compile('0 0 */2 * 1', TARGETS.vixie)),
        'At 12:00 AM on Mondays that fall on the 1st, 3rd, 5th, 7th, 9th, 11th, 13th, 15th, 17th, 19th, 21st, 23rd, 25th, 27th, 29th, and 31st of the month.',
    )
    // Neither starts with *, so either may match.
    assert.deepEqual(days('vixie', '0 0 3 * 1', 3), ['2026-01-03', '2026-01-05', '2026-01-12'])
})

test('the built-in matcher agrees with Effect and cron-parser on day logic', () => {
    const fromEffect = effect(EffectCron, { timezone: 'UTC' })
    const fromParser = cronParser(CronExpressionParser, { timezone: 'UTC' })

    for (const value of ['0 0 */2 * 1', '0 0 3 * 1', '0 9 * * 1-5', '30 6 1,15 * *']) {
        const ours = (target: typeof fromEffect) =>
            nextRuns(compile(value, target.profile), { from, count: 8, timezone: 'UTC' }).map(date => date.toISOString())
        const theirs = (target: typeof fromEffect) => target.nextRuns?.(value, { from, count: 8, timezone: 'UTC' }).map(date => date.toISOString())

        assert.deepEqual(ours(fromEffect), theirs(fromEffect), `effect ${value}`)
        assert.deepEqual(ours(fromParser), theirs(fromParser), `cron-parser ${value}`)
    }
})

test('Quartz has seconds, counts Sunday as 1, and needs ? in the day field it does not use', () => {
    const quartz = TARGETS.quartz

    assert.equal(compile('0 0 9 ? * 2-6', quartz).ok, true)
    assert.equal(describe(compile('0 0 9 ? * 2-6', quartz)), 'At 9:00 AM on weekdays.')
    assert.equal(messageFor(compile('0 0 9 * * 2-6', quartz))?.text, 'Quartz needs ? in the day field you don’t use.')
    assert.deepEqual(messageFor(compile('0 0 9 * * 2-6', quartz))?.fix?.changes, { day: '?' })
    assert.equal(messageFor(compile('0 0 9 1 * 2', quartz))?.text, 'Quartz can’t use both day fields. Set one to ?.')
    // Picking a weekday writes ? into the day of month, and picking a day of month clears the weekday.
    assert.equal(applyChanges('0 0 9 * * ?', { weekday: '2' }, quartz), '0 0 9 ? * 2')
    assert.equal(applyChanges('0 0 9 ? * 2', { day: '15' }, quartz), '0 0 9 15 * ?')
    assert.equal(describe(compile('*/10 0 9 ? * 2', quartz)), 'Every 10 seconds, at 9:00 AM on Mondays.')
})

test('EventBridge adds a year and allows one # rule on its own', () => {
    const eventbridge = TARGETS.eventbridge

    assert.equal(describe(compile('15 10 ? * 6L 2027', eventbridge)), 'At 10:15 AM on the last Friday of the month, in 2027.')
    assert.equal(compile('0 9 ? * 3#1,6#3 *', eventbridge).ok, false)
    assert.deepEqual(
        nextRuns(compile('0 9 ? * 2#1 2027', eventbridge), { from, count: 2, timezone: 'UTC' }).map(date => date.toISOString().slice(0, 10)),
        ['2027-01-04', '2027-02-01'],
    )
})

test('Vercel reads numbers only and one day field at a time', () => {
    const vercel = TARGETS.vercel

    assert.equal(messageFor(compile('0 9 * * MON', vercel))?.text, 'Day of week: Vercel doesn’t read names. Use numbers.')
    assert.deepEqual(messageFor(compile('0 9 * * MON', vercel))?.fix?.changes, { weekday: '1' })
    assert.equal(compile('0 9 1 * 1', vercel).ok, false)
    assert.equal(applyChanges('0 9 1 * *', { weekday: '1-5' }, vercel), '0 9 * * 1-5')
    assert.deepEqual(presets('vercel'), ['Every day', 'On the 1st', 'On the 1st and 15th', 'Every day', 'Weekdays', 'Weekends'])
})

test('Cloudflare counts Sunday as 1 in presets and day toggles', () => {
    const cloudflare = TARGETS.cloudflare
    const days = menu('days', compile('0 9 * * *', cloudflare))
    const weekdays = days.sections.at(-1)?.presets.find(([label]) => label === 'Weekdays')

    assert.deepEqual(weekdays?.[1], { weekday: '2-6' })
    assert.equal(describe(compile('0 9 * * 2-6', cloudflare)), 'At 9:00 AM on weekdays.')
    assert.equal(describe(compile('0 9 * * 6L', cloudflare)), 'At 9:00 AM on the last Friday of the month.')
})

test('GitHub Actions warns below its five-minute minimum and runs in UTC', () => {
    const github = resolveTarget('github')
    const value = '*/2 * * * *'
    const result = status(value, compile(value, github.profile), github)

    assert.equal(result.valid, true)
    assert.equal(result.message?.text, 'GitHub Actions runs a schedule at most every 5 minutes.')
    assert.equal(result.description, 'Every 2 minutes (UTC).')
    assert.equal(compile('20/15 * * * *', github.profile).ok, true)
})

test('presets follow what the target reads', () => {
    assert.ok(presets('croner').includes('Last weekday'))
    assert.ok(!presets('cron-parser').includes('Last weekday'))
    assert.ok(presets('cron-parser').includes('Last Friday'))
    assert.ok(!presets('effect').includes('First Monday'))
    assert.deepEqual(
        menu('minute', compile('0 9 * * *', TARGETS.github)).sections[0]?.presets.map(([, changes]) => changes.minute),
        ['*', '0/5', '0/10', '0/15', '0/30', '0'],
    )
})

test('cron-parser strict mode adds the seconds field it requires', () => {
    const strict = cronParser(CronExpressionParser, { strict: true, timezone: 'UTC' })

    assert.deepEqual(strict.profile.fields, ['second', 'minute', 'hour', 'day', 'month', 'weekday'])
    assert.deepEqual(strict.validate?.('0 0 9 * * *'), { ok: true })
})

test('the built-in matcher keeps wall times across DST changes', () => {
    const chicago = (value: string, from: string, count = 1) =>
        nextRuns(compile(value, TARGETS.croner), { from: new Date(from), count, timezone: 'America/Chicago' }).map(date => date.toISOString())

    // 3 AM on the day clocks spring forward exists, as 3 AM CDT; 2:30 AM doesn't, and moves past the gap.
    assert.deepEqual(chicago('0 3 * * *', '2026-03-08T07:59:00Z'), ['2026-03-08T08:00:00.000Z'])
    assert.deepEqual(chicago('30 2 * * *', '2026-03-08T07:00:00Z'), ['2026-03-08T08:30:00.000Z'])
    // 1:30 AM happens twice when clocks fall back; the schedule runs at the first.
    assert.deepEqual(chicago('30 1 * * *', '2026-11-01T05:00:00Z', 2), ['2026-11-01T06:30:00.000Z', '2026-11-02T07:30:00.000Z'])
})

test('targets restrict which extensions can share a field', () => {
    assert.equal(
        messageFor(compile('0 0 * * 1,5#2', TARGETS['cron-parser']))?.text,
        'Day of week: cron-parser needs 5#2 on its own, with nothing else in the field.',
    )
    assert.equal(compile('0 0 * * 1,5L', TARGETS['cron-parser']).ok, true)
    assert.equal(compile('0 0 0 ? * 3#1,6#3', TARGETS.quartz).ok, false)
    assert.equal(compile('0 0 0 1,L * ?', TARGETS.quartz).ok, false)
    assert.equal(compile('0 0 1,L * *', TARGETS.croner).ok, true)
})

test('Effect caps steps at the field’s highest value', () => {
    assert.equal(messageFor(compile('*/60 * * * *', TARGETS.effect))?.text, 'Minutes: A step has to be 1 to 59.')
    assert.equal(compile('0 */24 * * *', TARGETS.effect).ok, false)
    assert.equal(compile('*/60 * * * *', TARGETS.croner).ok, true)
})

test('Quartz reads a bare L in the day of week as Saturday', () => {
    const c = compile('0 0 9 ? * L', TARGETS.quartz)

    assert.equal(c.ok, true)
    assert.equal(describe(c), 'At 9:00 AM on Saturdays.')
})

test('Quartz and EventBridge wrap ranges past the field’s end', () => {
    assert.equal(describe(compile('0 0 22-2 ? * 2', TARGETS.quartz)), 'At 12:00 AM, 1:00 AM, 2:00 AM, 10:00 PM, and 11:00 PM on Mondays.')
    assert.deepEqual([...(compile('0 0 0 ? * 6-2', TARGETS.quartz).parsed.weekday?.set ?? [])].sort(), [0, 1, 5, 6])
    assert.equal(compile('0/30 20-2 ? * MON-FRI *', TARGETS.eventbridge).ok, true)
    assert.equal(compile('0 22-2 * * *', TARGETS.croner).ok, false)
})

test('a step from Sunday written as 7 runs to 7', () => {
    // cron-parser runs 7/2 as Sunday alone, a step from 7 to 7.
    assert.deepEqual(days('cron-parser', '0 0 * * 7/2', 2), ['2026-01-04', '2026-01-11'])
    assert.deepEqual(messageFor(compile('0 0 * * 7/2', TARGETS.vixie))?.fix?.changes, { weekday: '7-7/2' })
})

test('year ranges follow the target', () => {
    const croner7 = {
        ...TARGETS.croner,
        fields: ['second', 'minute', 'hour', 'day', 'month', 'weekday', 'year'] as const,
        years: [1, 9999] as [number, number],
    }

    assert.equal(compile('0 0 0 1 1 * 2200', { ...croner7, fields: [...croner7.fields] }).ok, true)
    assert.equal(compile('0 0 1 1 ? 2200', TARGETS.eventbridge).ok, false)
    // A * year stops at EventBridge's last year.
    assert.deepEqual(nextRuns(compile('0 0 * * ? *', TARGETS.eventbridge), { from: new Date('2199-12-31T23:59:59Z'), timezone: 'UTC' }), [])
})

test('presets can be replaced or extended per field, and take the chip’s words', () => {
    const c = compile('0 9 * * *', TARGETS.vercel)
    const labels = (key: 'hour' | 'days', presets: Parameters<typeof menu>[2]) =>
        menu(key, c, presets).sections.map(section => section.presets.map(([label, changes]) => `${label} ${Object.values(changes)[0]}`))

    assert.deepEqual(labels('hour', { presets: { hour: ['*', '8-18', '12'] } }), [['Every hour *', '8 AM–6 PM 8-18', 'At 12 PM 12']])
    // A function extends the defaults; tokens the target can't read, such as L on Vercel, drop out.
    assert.deepEqual(labels('days', { presets: { day: defaults => [...defaults, 'L', '10-20'], weekday: ['1,3,5'] } }), [
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
