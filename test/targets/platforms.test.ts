/*
 * Platforms without a parser library: each profile accepts what the platform documents, and runs, writes and words
 * schedules by the platform's rules.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyChanges, compile, describe, menu, messageFor, nextRuns, resolveTarget, status, TARGETS, toggleDay, type TargetName } from '../../src/index.ts'
import { PLATFORMS, type Platform } from '../support/platforms.ts'

const from = new Date('2026-01-02T12:00:00Z')
const days = (name: TargetName, value: string, count = 6) =>
    nextRuns(compile(value, TARGETS[name]), { from, count, timezone: 'UTC' }).map(date => date.toISOString().slice(0, 10))
const presets = (name: TargetName) => menu('days', compile('0 9 * * *', TARGETS[name])).sections.flatMap(section => section.presets)

for (const [name, { rows, pins }] of Object.entries(PLATFORMS) as [TargetName, Platform][]) {
    test(`the ${name} profile accepts what its docs allow and refuses what they rule out, except where pinned`, () => {
        const mismatches = rows
            .filter(([value, expect]) => compile(value, TARGETS[name]).ok !== (expect === 'accept'))
            .map(([value, expect]) => `${value}: docs ${expect}, profile ${expect === 'accept' ? 'rejects' : 'accepts'}`)

        assert.deepEqual(mismatches, pins)
    })
}

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

test('Quartz has seconds, counts Sunday as 1, and needs ? in the day field it does not use', () => {
    const quartz = TARGETS.quartz

    assert.equal(describe(compile('0 0 9 ? * 2-6', quartz)), 'At 9:00 AM on weekdays.')
    assert.equal(describe(compile('*/10 0 9 ? * 2', quartz)), 'Every 10 seconds, at 9:00 AM on Mondays.')
    assert.equal(describe(compile('0 0 9 ? * L', quartz)), 'At 9:00 AM on Saturdays.')
    assert.equal(messageFor(compile('0 0 9 * * 2-6', quartz))?.text, 'Quartz needs ? in the day field you don’t use.')
    assert.deepEqual(messageFor(compile('0 0 9 * * 2-6', quartz))?.fix?.changes, { day: '?' })
    assert.equal(messageFor(compile('0 0 9 1 * 2', quartz))?.text, 'Quartz can’t use both day fields. Set one to ?.')
    // Picking a weekday writes ? into the day of month, and picking a day of month clears the weekday.
    assert.equal(applyChanges('0 0 9 * * ?', { weekday: '2' }, quartz), '0 0 9 ? * 2')
    assert.equal(applyChanges('0 0 9 ? * 2', { day: '15' }, quartz), '0 0 9 15 * ?')
})

test('EventBridge adds a year, reads a bare L as Saturday, and takes no step in the day of week', () => {
    const eventbridge = TARGETS.eventbridge

    assert.equal(describe(compile('15 10 ? * 6L 2027', eventbridge)), 'At 10:15 AM on the last Friday of the month, in 2027.')
    assert.deepEqual(days('eventbridge', '0 9 ? * 2#1 2027', 2), ['2027-01-04', '2027-02-01'])
    assert.equal(describe(compile('0 9 ? * L *', eventbridge)), 'At 9:00 AM on Saturdays.')
    assert.deepEqual(days('eventbridge', '0 9 ? * L *', 2), ['2026-01-03', '2026-01-10'])
    // The fix lists the days the step gives, counting Sunday as 1.
    assert.equal(messageFor(compile('0 9 ? * 1/2 *', eventbridge))?.text, 'Day of week: EventBridge doesn’t support /.')
    assert.deepEqual(messageFor(compile('0 9 ? * 1/2 *', eventbridge))?.fix?.changes, { weekday: '1,3,5,7' })
})

test('Vercel reads numbers only and one day field at a time', () => {
    const vercel = TARGETS.vercel

    assert.equal(messageFor(compile('0 9 * * MON', vercel))?.text, 'Day of week: Vercel doesn’t read names. Use numbers.')
    assert.deepEqual(messageFor(compile('0 9 * * MON', vercel))?.fix?.changes, { weekday: '1' })
    assert.equal(messageFor(compile('0 9 * * 7', vercel))?.text, 'Day of week: 7 is out of range. Days of the week go from 0 to 6.')
    assert.equal(applyChanges('0 9 1 * *', { weekday: '1-5' }, vercel), '0 9 * * 1-5')
    assert.deepEqual(
        presets('vercel').map(([label]) => label),
        ['Every day', 'On the 1st', 'On the 1st and 15th', 'Every day', 'Weekdays', 'Weekends'],
    )
})

test('Cloudflare counts Sunday as 1 in presets, day toggles and runs', () => {
    const cloudflare = TARGETS.cloudflare

    assert.deepEqual(
        presets('cloudflare').find(([label]) => label === 'Weekdays'),
        ['Weekdays', '2-6'],
    )
    assert.deepEqual(toggleDay(compile('0 9 * * 2-6', cloudflare), 0), { weekday: '1-6' })
    assert.equal(describe(compile('0 9 * * 1', cloudflare)), 'At 9:00 AM on Sundays.')
    assert.deepEqual(days('cloudflare', '0 9 * * 1', 2), ['2026-01-04', '2026-01-11'])
    assert.equal(describe(compile('0 9 * * 6L', cloudflare)), 'At 9:00 AM on the last Friday of the month.')
    // An assumption: the docs don't say how the two day fields combine. Cloudflare's parser matches either.
    assert.deepEqual(days('cloudflare', '0 0 3 * 2', 3), ['2026-01-03', '2026-01-05', '2026-01-12'])
})

test('GitHub Actions warns below its five-minute minimum, runs in UTC unless the field sets a zone, and reads Sunday as 0 only', () => {
    const github = resolveTarget('github')
    const every2 = status('*/2 * * * *', compile('*/2 * * * *', github.profile), github)
    const nine = compile('0 9 * * *', github.profile)

    assert.equal(every2.valid, true)
    assert.equal(every2.message?.text, 'GitHub Actions runs a schedule at most every 5 minutes.')
    assert.equal(every2.description, 'Every 2 minutes (UTC).')
    assert.equal(status('0 9 * * *', nine, github, { timezone: 'America/New_York' }).description, 'At 9:00 AM every day (America/New_York).')
    assert.deepEqual(nextRuns(nine, { from, timezone: 'America/New_York' }), [new Date('2026-01-02T14:00:00Z')])
    // A step from Monday stops at Saturday, since 7 isn't Sunday here.
    assert.deepEqual(days('github', '0 0 * * 1/2', 4), ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12'])
    // An assumption: the docs don't say how the two day fields combine. The profile follows Vixie cron: odd days that are Mondays.
    assert.deepEqual(days('github', '0 0 */2 * 1', 2), ['2026-01-05', '2026-01-19'])
})
