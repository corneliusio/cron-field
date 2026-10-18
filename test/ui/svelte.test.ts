/*
 * The Svelte wrapper: server rendering and hydration, bind:value both ways, a one-way value, props reaching the
 * field, bind:field, and unmounting. SvelteHost.svelte is the parent, since a bindable prop needs a runes parent.
 */
import '../support/dom.ts'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Cron } from 'croner'
import { flushSync, hydrate, mount, unmount, type Component } from 'svelte'
import { render } from 'svelte/server'
import { croner } from '../../src/adapters/croner.ts'
import { CronField, type CronFieldProps } from '../../src/svelte/index.js'
import { chip, key, sameNode, tokens, trackListeners } from '../support/dom.ts'
import SvelteHost from '../support/SvelteHost.svelte'

// The loader compiles a `?server` import for Svelte's server renderer; a URL keeps TypeScript from resolving the query.
const { default: ServerField }: { default: Component<CronFieldProps> } = await import(new URL('../../src/svelte/CronField.svelte?server', import.meta.url).href)

const apps: Record<string, unknown>[] = []

afterEach(() => {
    apps.splice(0).forEach(app => unmount(app))
    document.body.replaceChildren()
})

const host = (props: Parameters<typeof SvelteHost>[1]) => {
    const target = document.body.appendChild(document.createElement('div'))
    const app = mount(SvelteHost, { target, props })

    apps.push(app)
    flushSync()

    return { target, app }
}

/** Clears the hour chip, as a user would with Backspace. */
const clearHour = (target: HTMLElement) => {
    key(chip(target, 'hour'), 'Backspace')
    flushSync()
}

test('the server renders a plain input that submits the value, with no chips', () => {
    const { body } = render(ServerField, { props: { name: 'schedule', value: '0 9 * * 1-5', label: 'Runs', disabled: true } })
    const container = document.createElement('div')

    container.innerHTML = body

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')

    assert.deepEqual([input?.name, input?.value, input?.getAttribute('aria-label'), input?.disabled], ['schedule', '0 9 * * 1-5', 'Runs', true])
    sameNode(container.querySelector('[data-part="chip"]'), null)
})

test('hydration swaps the plain input for the field without mismatches, and the form still submits the value', t => {
    const props = { name: 'schedule', value: '0 9 * * 1-5' }
    const form = document.body.appendChild(document.createElement('form'))
    const warnings: unknown[] = []

    form.innerHTML = render(ServerField, { props }).body
    assert.deepEqual([...new FormData(form)], [['schedule', '0 9 * * 1-5']])

    // Svelte's dev build warns about hydration mismatches.
    t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args))
    t.mock.method(console, 'error', (...args: unknown[]) => warnings.push(args))
    apps.push(hydrate(CronField, { target: form, props }))
    flushSync()
    assert.deepEqual(warnings, [])
    sameNode(form.querySelector('input[type="text"][name]'), null)
    assert.equal(tokens(form), '0 9 * * 1-5')
    assert.deepEqual([...new FormData(form)], [['schedule', '0 9 * * 1-5']])
})

test('bind:value carries the user’s change to the parent and the parent’s later values to the field', t => {
    const warnings: unknown[] = []

    // Svelte's dev build warns about bindings it can't keep in sync.
    t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args))

    const { target, app } = host({ value: '0 9 * * 1-5' })

    clearHour(target)
    assert.equal(app.get(), '0 * * * 1-5')

    app.set('15 10 * * *')
    flushSync()
    assert.equal(tokens(target), '15 10 * * *')
    assert.deepEqual(warnings, [])
})

test('a value passed one way keeps the user’s edit in the field and leaves the parent’s value alone', () => {
    const { target, app } = host({ value: '0 9 * * 1-5', bind: false })

    clearHour(target)
    assert.equal(tokens(target), '0 * * * 1-5')
    assert.equal(app.get(), '0 9 * * 1-5')
})

test('prop changes reach the field: a target with other fields switches to Edit as cron, and a removed prop goes back to its default', () => {
    const { target, app } = host({ value: '0 9 * * 1-5', label: 'Runs' })
    const text = (part: string) => target.querySelector(`[data-part="${part}"]`)?.textContent

    assert.equal(text('label'), 'Runs')

    app.update({})
    flushSync()
    assert.equal(text('label'), 'Schedule')

    app.update({ target: 'quartz' })
    flushSync()
    assert.ok(target.querySelector('[data-part="root"]')?.hasAttribute('data-raw'))
    assert.equal(text('message'), 'Quartz needs 6 fields. This has 5.')
})

test('passing a new adapter object keeps an open menu open and focused', () => {
    const { target, app } = host({ value: '0 9 * * 1-5', target: croner(Cron) })

    key(chip(target, 'hour'), 'ArrowDown')

    const menu = target.querySelector('[data-part="menu"]')
    const focused = document.activeElement

    assert.ok(menu?.contains(focused))

    app.update({ target: croner(Cron) })
    flushSync()
    sameNode(target.querySelector('[data-part="menu"]'), menu)
    sameNode(document.activeElement, focused)
})

test('bind:field holds the instance, and unmounting destroys the field', () => {
    const listeners = trackListeners()
    const target = document.body.appendChild(document.createElement('div'))
    const app = mount(SvelteHost, { target, props: { value: '0 9 * * 1-5' } })

    flushSync()
    assert.equal(app.instance()?.value, '0 9 * * 1-5')

    app.instance()?.setValue('15 10 * * *')
    assert.equal(tokens(target), '15 10 * * *')
    assert.ok(listeners.attached().includes('pointerdown'))

    unmount(app)
    flushSync()
    listeners.stop()
    assert.equal(target.innerHTML, '')
    assert.deepEqual(listeners.attached(), [])
})
