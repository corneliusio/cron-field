/*
 * The React wrapper: server rendering and hydration, controlled and uncontrolled values, props reaching the
 * field, the ref, and unmounting.
 */
import '../support/dom.ts'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Cron } from 'croner'
import { act, createElement as h, createRef, useState, type ReactElement } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { croner } from '../../src/adapters/croner.ts'
import { CronField, type ChangeDetail, type CronFieldInstance } from '../../src/react/index.tsx'
import { chip, key, sameNode, tick, tokens, trackListeners } from '../support/dom.ts'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const roots: Root[] = []

afterEach(async () => {
    await act(async () => roots.splice(0).forEach(root => root.unmount()))
    document.body.replaceChildren()
})

const render = async (element: ReactElement) => {
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)

    roots.push(root)
    await act(async () => root.render(element))

    return { container, rerender: (next: ReactElement) => act(async () => root.render(next)) }
}

/** Clears the hour chip, as a user would with Backspace, and lets the wrapper's put-back run. */
const clearHour = (container: HTMLElement) =>
    act(async () => {
        key(chip(container, 'hour'), 'Backspace')
        await tick()
    })

test('the server renders a plain input that submits the value, with no chips', () => {
    const html = renderToString(h(CronField, { name: 'schedule', value: '0 9 * * 1-5', label: 'Runs', disabled: true }))
    const container = document.createElement('div')

    container.innerHTML = html

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')

    assert.deepEqual([input?.name, input?.value, input?.getAttribute('aria-label'), input?.disabled], ['schedule', '0 9 * * 1-5', 'Runs', true])
    sameNode(container.querySelector('[data-part="chip"]'), null)
})

test('hydration swaps the plain input for the field without mismatches, and the form still submits the value', async t => {
    const element = h(CronField, { name: 'schedule', value: '0 9 * * 1-5' })
    const form = document.body.appendChild(document.createElement('form'))
    const errors: unknown[] = []

    form.innerHTML = renderToString(element)
    assert.deepEqual([...new FormData(form)], [['schedule', '0 9 * * 1-5']])

    // React reports a structural mismatch as a recoverable error and logs an attribute mismatch.
    t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args))
    await act(async () => {
        roots.push(hydrateRoot(form, element, { onRecoverableError: error => errors.push(error) }))
    })
    assert.deepEqual(errors, [])
    sameNode(form.querySelector('input[type="text"][name]'), null)
    assert.equal(tokens(form), '0 9 * * 1-5')
    assert.deepEqual([...new FormData(form)], [['schedule', '0 9 * * 1-5']])
})

test('a controlled field reports a change once and goes back to the parent’s value when the parent keeps it', async () => {
    const changes: [string, ChangeDetail][] = []
    const { container } = await render(h(CronField, { value: '0 9 * * 1-5', onChange: (value, detail) => changes.push([value, detail]) }))

    await clearHour(container)
    assert.deepEqual(
        changes.map(([value, { valid, description }]) => [value, valid, description]),
        [['0 * * * 1-5', true, 'Every hour, on the hour, on weekdays.']],
    )
    assert.equal(tokens(container), '0 9 * * 1-5')
})

test('a controlled field keeps a change the parent takes, and shows the parent’s later values', async () => {
    const parent: { set?: (value: string) => void } = {}
    const Parent = () => {
        const [value, setValue] = useState('0 9 * * 1-5')

        parent.set = setValue

        return h(CronField, { value, onChange: setValue })
    }
    const { container } = await render(h(Parent))

    await clearHour(container)
    assert.equal(tokens(container), '0 * * * 1-5')

    await act(async () => parent.set?.('15 10 * * *'))
    assert.equal(tokens(container), '15 10 * * *')
})

test('an uncontrolled field keeps the user’s edit and ignores a later defaultValue', async () => {
    const { container, rerender } = await render(h(CronField, { defaultValue: '0 9 * * 1-5' }))

    await clearHour(container)
    assert.equal(tokens(container), '0 * * * 1-5')

    await rerender(h(CronField, { defaultValue: '15 10 * * *' }))
    assert.equal(tokens(container), '0 * * * 1-5')
})

test('prop changes reach the field: a target with other fields switches to Edit as cron, and a removed prop goes back to its default', async () => {
    const { container, rerender } = await render(h(CronField, { defaultValue: '0 9 * * 1-5', label: 'Runs' }))
    const text = (part: string) => container.querySelector(`[data-part="${part}"]`)?.textContent

    assert.equal(text('label'), 'Runs')

    await rerender(h(CronField, { defaultValue: '0 9 * * 1-5' }))
    assert.equal(text('label'), 'Schedule')

    await rerender(h(CronField, { defaultValue: '0 9 * * 1-5', target: 'quartz' }))
    assert.ok(container.querySelector('[data-part="root"]')?.hasAttribute('data-raw'))
    assert.equal(text('message'), 'Quartz needs 6 fields. This has 5.')
})

test('re-rendering with a new adapter object keeps an open menu open and focused', async () => {
    const { container, rerender } = await render(h(CronField, { defaultValue: '0 9 * * 1-5', target: croner(Cron) }))

    await act(async () => key(chip(container, 'hour'), 'ArrowDown'))

    const menu = container.querySelector('[data-part="menu"]')
    const focused = document.activeElement

    assert.ok(menu?.contains(focused))

    await rerender(h(CronField, { defaultValue: '0 9 * * 1-5', target: croner(Cron) }))
    sameNode(container.querySelector('[data-part="menu"]'), menu)
    sameNode(document.activeElement, focused)
})

test('the ref holds the field instance, and unmounting destroys the field', async () => {
    const ref = createRef<CronFieldInstance>()
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)
    const listeners = trackListeners()

    await act(async () => root.render(h(CronField, { ref, defaultValue: '0 9 * * 1-5' })))
    assert.equal(ref.current?.value, '0 9 * * 1-5')

    await act(async () => ref.current?.setValue('15 10 * * *'))
    assert.equal(tokens(container), '15 10 * * *')
    assert.ok(listeners.attached().includes('pointerdown'))

    await act(async () => root.unmount())
    listeners.stop()
    assert.equal(ref.current, null)
    assert.equal(container.innerHTML, '')
    assert.deepEqual(listeners.attached(), [])
})
