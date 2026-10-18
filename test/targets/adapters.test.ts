/*
 * Adapters: each croner, cron-parser and Effect setup builds a profile that accepts what its library accepts and runs
 * when it runs, the menus only write what the library reads, and every adapter keeps the target contract.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CronExpressionParser } from 'cron-parser'
import { Cron } from 'croner'
import { Cron as EffectCron } from 'effect'
import { cronParser } from '../../src/adapters/cron-parser.ts'
import { croner } from '../../src/adapters/croner.ts'
import { effect } from '../../src/adapters/effect.ts'
import { dateEngine } from '../../src/core/engine.ts'
import { matchRuns } from '../../src/core/schedule.ts'
import {
    applyChanges,
    compile,
    format,
    menu,
    menuOf,
    nextRuns,
    nthOptions,
    nthToken,
    status,
    TARGETS,
    toggleDay,
    upcoming,
    type Target,
} from '../../src/index.ts'
import { SECONDS, SETUPS, SHARED, YEARS } from '../support/corpus.ts'

// Late February crosses into March (L, LW, W, the 29th to 31st); late December crosses into a new year.
const STARTS = ['2026-02-25T12:00:00Z', '2026-12-30T12:00:00Z'] as const
const WEEK = [0, 1, 2, 3, 4, 5, 6]
const ADAPTERS = {
    'croner': (timezone: string) => croner(Cron, { timezone }),
    'cron-parser': (timezone: string) => cronParser(CronExpressionParser, { timezone }),
    'Effect': (timezone: string) => effect(EffectCron, { timezone }),
}

const verdict = (ok: boolean, runs: number[]) => (!ok ? 'rejects' : runs.length ? 'runs' : 'never runs')
const minute = (time: number | undefined) => (time === undefined ? 'none' : new Date(time).toISOString().slice(0, 16))

/** The corpus in the setup's own fields. */
const corpus = ({ profile }: Target) => {
    const seconds = profile.fields[0] === 'second'
    const year = profile.fields.at(-1) === 'year'
    const write = (value: string) => (!value || value.startsWith('@') ? value : `${seconds ? '0 ' : ''}${value}${year ? ' *' : ''}`)

    return [...SHARED.map(write), ...(seconds ? SECONDS.map(value => (year ? `${value} *` : value)) : []), ...(year ? YEARS : [])]
}

for (const { name, target, pins } of SETUPS) {
    test(`${name}: the profile accepts and runs what the library does, except where pinned`, () => {
        const mismatches: string[] = []

        for (const value of corpus(target)) {
            const c = compile(value, target.profile)
            const accepted = target.validate?.(value).ok ?? true
            const ours = (from: string) => matchRuns(c, { from: Date.parse(from), count: 5, timezone: 'UTC' }, dateEngine)
            const theirs = (from: string) => (accepted ? (target.nextRuns?.(value, { from: new Date(from), count: 5 }) ?? []).map(date => date.getTime()) : [])
            const profile = verdict(c.ok, ours(STARTS[0]))
            const library = verdict(accepted, theirs(STARTS[0]))

            // A library may refuse a schedule the profile knows never runs: the field gives its own reason first.
            if (profile !== library && !(profile === 'never runs' && library === 'rejects')) {
                mismatches.push(`${value || '(empty)'}: profile ${profile}, library ${library}`)
            }

            if (profile !== 'runs' || library !== 'runs') {
                continue
            }

            for (const start of STARTS) {
                const a = ours(start)
                const b = theirs(start)
                const first = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).find(i => a[i] !== b[i])

                if (first !== undefined) {
                    mismatches.push(`${value}: from ${start.slice(0, 10)}, profile ${minute(a[first])}, library ${minute(b[first])}`)
                }
            }
        }

        assert.deepEqual(mismatches, pins)
    })
}

for (const library of Object.keys(ADAPTERS)) {
    test(`every value the menus write for ${library} is one ${library} accepts`, () => {
        const refused: string[] = []

        for (const { name, target } of SETUPS.filter(setup => setup.name.startsWith(library))) {
            const profile = target.profile
            const bases = [
                { minute: '0', hour: '9' },
                { minute: '30', hour: '6', weekday: '1-5' },
                { minute: '0', hour: '9', day: '15' },
            ]

            for (const base of bases.map(tokens => format({ second: '0', ...tokens }, profile))) {
                const c = compile(base, profile)
                const menus = new Set(profile.fields.map(field => menuOf(field, profile)))
                const written = [
                    ...[...menus].flatMap(key =>
                        menu(key, c, { year: 2026 }).sections.flatMap(section =>
                            section.presets.map(([, token]) => applyChanges(base, { [section.field]: token }, profile)),
                        ),
                    ),
                    ...nthOptions(profile).flatMap(([k]) => WEEK.map(day => applyChanges(base, { weekday: nthToken(k, day, profile) }, profile))),
                    ...WEEK.map(day => applyChanges(base, toggleDay(c, day), profile)),
                ]

                refused.push(...written.filter(value => !compile(value, profile).ok || !target.validate?.(value).ok).map(value => `${name}: ${value}`))
            }
        }

        assert.deepEqual(refused, [])
    })
}

test('an adapter returns no runs, without throwing, for a schedule that never runs or that its library refuses', () => {
    const from = new Date('2026-02-25T12:00:00Z')

    for (const [name, make] of Object.entries(ADAPTERS)) {
        for (const value of ['0 9 31 2 *', '0 0 30 2 *', '0 0 31 4,6,9,11 *', '0 9 * * nope']) {
            assert.deepEqual(make('UTC').nextRuns?.(value, { from, count: 3 }), [], `${name}: ${value}`)
        }
    }
})

test('upcoming returns a library’s runs after from, in order and each once, and asks again when repeats leave it short', () => {
    const from = new Date('2026-01-05T00:00:00Z')
    const hour = (n: number) => new Date(from.getTime() + n * 3_600_000)
    const fake = (runs: (count: number) => Date[]) => {
        const asked: number[] = []
        const target: Target = {
            profile: TARGETS.vixie,
            nextRuns: (_, { count }) => {
                asked.push(count)

                return runs(count)
            },
        }

        return { asked, target }
    }
    // Each run twice, newest first, starting with `from` itself.
    const repeating = fake(count => Array.from({ length: count }, (_, i) => hour(Math.floor(i / 2))).reverse())
    const stuck = fake(count => Array.from({ length: count }, () => hour(1)))
    const unasked = fake(() => [hour(1)])

    assert.deepEqual(upcoming(repeating.target, '0 * * * *', { from, count: 3 }), [hour(1), hour(2), hour(3)])
    assert.deepEqual(repeating.asked, [3, 6, 12])
    // Twice as many, twice at most.
    assert.deepEqual(upcoming(stuck.target, '0 * * * *', { from, count: 3 }), [hour(1)])
    assert.deepEqual(stuck.asked, [3, 6, 12])
    // The built-in matcher finds no February 31st, so the library is never asked to search for one.
    assert.deepEqual(upcoming(unasked.target, '0 9 31 2 *', { from, count: 3 }), [])
    assert.deepEqual(unasked.asked, [])
})

test('a run count that isn’t a whole number counts whole runs', () => {
    const target = croner(Cron, { timezone: 'UTC' })
    const from = new Date('2026-01-01T00:00:00Z')

    // croner itself never stops looking for a fractional count.
    assert.equal(upcoming(target, '* * * * *', { from, count: 1.5 }).length, 1)
    assert.deepEqual(upcoming(target, '* * * * *', { from, count: Number.NaN }), [])
    assert.equal(nextRuns(compile('* * * * *', target.profile), { from, count: 2.5 }).length, 2)
})

test('the adapter’s time zone reaches the library, and a time zone passed to upcoming overrides it', () => {
    const from = new Date('2026-01-05T00:00:00Z')
    // 9:00 in Chicago is 15:00 UTC in January.
    const nine = [new Date('2026-01-05T15:00:00Z')]

    for (const [name, make] of Object.entries(ADAPTERS)) {
        assert.deepEqual(upcoming(make('America/Chicago'), '0 9 * * *', { from }), nine, name)
        assert.deepEqual(upcoming(make('Asia/Tokyo'), '0 9 * * *', { from, timezone: 'America/Chicago' }), nine, name)
    }
})

test('status gives the field’s reason for a schedule that never runs, and a library’s refusal in the library’s words', () => {
    const now = { ...dateEngine, now: () => Date.parse('2026-06-15T00:00:00Z') }
    const text = (target: Target, value: string) => status(value, compile(value, target.profile), target, { engine: now }).message?.text
    const refusing: Target = { profile: TARGETS.vixie, validate: () => ({ ok: false, message: 'Not on a Tuesday.' }) }

    // cron-parser refuses February 31st itself, as an invalid explicit day of month.
    assert.equal(text(ADAPTERS['cron-parser']('UTC'), '0 9 31 2 *'), 'February never has a 31st.')
    assert.equal(text(refusing, '0 9 * * 2'), 'Cron can’t run this schedule: Not on a Tuesday.')
})
