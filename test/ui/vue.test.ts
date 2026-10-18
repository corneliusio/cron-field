/*
 * The Vue wrapper: server rendering and hydration, v-model with and without a parent that takes changes, props
 * reaching the field, the exposed instance, and unmounting.
 */
import '../support/dom.ts'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Cron } from 'croner'
import { createApp, createSSRApp, defineComponent, h, nextTick, ref, shallowRef, type App, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { croner } from '../../src/adapters/croner.ts'
import type { TargetInput } from '../../src/index.ts'
import { CronField, type ChangeDetail, type CronFieldInstance } from '../../src/vue/index.ts'
import { chip, find, key, sameNode, tick, tokens, trackListeners, typeInto } from '../support/dom.ts'

const apps: App[] = []

afterEach(() => {
    apps.splice(0).forEach(app => app.unmount())
    document.body.replaceChildren()
})

/** Mounts a parent whose render function reads refs, so changing them re-renders the field with new props. */
const mount = async (render: () => VNode) => {
    const container = document.body.appendChild(document.createElement('div'))
    const app = createApp(defineComponent({ setup: () => render }))

    app.mount(container)
    apps.push(app)
    // The plain input goes on the render after the field mounts.
    await nextTick()

    return container
}

/** Clears the hour chip, as a user would with Backspace, and lets the wrapper's put-back run. */
const clearHour = async (container: HTMLElement) => {
    key(chip(container, 'hour'), 'Backspace')
    await tick()
}

test('the server renders a plain input that submits the value, with no chips', async () => {
    const html = await renderToString(createSSRApp(() => h(CronField, { name: 'schedule', modelValue: '0 9 * * 1-5', label: 'Runs', disabled: true })))
    const container = document.createElement('div')

    container.innerHTML = html

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')

    assert.deepEqual([input?.name, input?.value, input?.getAttribute('aria-label'), input?.disabled], ['schedule', '0 9 * * 1-5', 'Runs', true])
    sameNode(container.querySelector('[data-part="chip"]'), null)
})

test('hydration swaps the plain input for the field without mismatches, and the form still submits the value', async t => {
    const create = () => createSSRApp(() => h(CronField, { name: 'schedule', modelValue: '0 9 * * 1-5' }))
    const form = document.body.appendChild(document.createElement('form'))
    const client = create()
    const warnings: unknown[] = []

    form.innerHTML = await renderToString(create())
    assert.deepEqual([...new FormData(form)], [['schedule', '0 9 * * 1-5']])

    // Vue warns about each mismatch and logs a summary after hydration.
    client.config.warnHandler = message => warnings.push(message)
    t.mock.method(console, 'error', (...args: unknown[]) => warnings.push(args))
    client.mount(form)
    apps.push(client)
    await nextTick()
    assert.deepEqual(warnings, [])
    sameNode(form.querySelector('input[type="text"][name]'), null)
    assert.equal(tokens(form), '0 9 * * 1-5')
    assert.deepEqual([...new FormData(form)], [['schedule', '0 9 * * 1-5']])
})

test('v-model reports a change once and the field goes back to the parent’s value when the parent keeps it', async () => {
    const updates: string[] = []
    const changes: [string, ChangeDetail][] = []
    const container = await mount(() =>
        h(CronField, {
            'modelValue': '0 9 * * 1-5',
            'onUpdate:modelValue': (value: string) => updates.push(value),
            'onChange': (value: string, detail: ChangeDetail) => changes.push([value, detail]),
        }),
    )

    await clearHour(container)
    assert.deepEqual(updates, ['0 * * * 1-5'])
    assert.deepEqual(
        changes.map(([value, { valid, description }]) => [value, valid, description]),
        [['0 * * * 1-5', true, 'Every hour, on the hour, on weekdays.']],
    )
    assert.equal(tokens(container), '0 9 * * 1-5')
})

test('v-model keeps a change the parent takes, and shows the parent’s later values', async () => {
    const value = ref('0 9 * * 1-5')
    const container = await mount(() => h(CronField, { 'modelValue': value.value, 'onUpdate:modelValue': (next: string) => (value.value = next) }))

    await clearHour(container)
    assert.equal(value.value, '0 * * * 1-5')
    assert.equal(tokens(container), '0 * * * 1-5')

    value.value = '15 10 * * *'
    await nextTick()
    assert.equal(tokens(container), '15 10 * * *')
})

test('without a model value the field keeps the user’s edit', async () => {
    const container = await mount(() => h(CronField))
    const input = find<HTMLInputElement>(container, '[data-part="input"]')

    // No value starts in Edit as cron.
    input.focus()
    typeInto(input, '0 9 * * 1-5')
    key(input, 'Enter')
    await tick()
    assert.equal(tokens(container), '0 9 * * 1-5')
})

test('prop changes reach the field: a target with other fields switches to Edit as cron, and a removed prop goes back to its default', async () => {
    const props = shallowRef<{ label?: string; target?: TargetInput }>({ label: 'Runs' })
    const container = await mount(() => h(CronField, { modelValue: '0 9 * * 1-5', ...props.value }))
    const text = (part: string) => container.querySelector(`[data-part="${part}"]`)?.textContent

    assert.equal(text('label'), 'Runs')

    props.value = {}
    await nextTick()
    assert.equal(text('label'), 'Schedule')

    props.value = { target: 'quartz' }
    await nextTick()
    assert.ok(container.querySelector('[data-part="root"]')?.hasAttribute('data-raw'))
    assert.equal(text('message'), 'Quartz needs 6 fields. This has 5.')
})

test('re-rendering with a new adapter object keeps an open menu open and focused', async () => {
    const renders = ref(0)
    const container = await mount(() => h(CronField, { 'modelValue': '0 9 * * 1-5', 'target': croner(Cron), 'data-renders': renders.value }))

    key(chip(container, 'hour'), 'ArrowDown')

    const menu = container.querySelector('[data-part="menu"]')
    const focused = document.activeElement

    assert.ok(menu?.contains(focused))

    renders.value++
    await nextTick()
    assert.ok(container.querySelector('[data-renders="1"]'), 'the parent rendered again')
    sameNode(container.querySelector('[data-part="menu"]'), menu)
    sameNode(document.activeElement, focused)
})

test('the exposed field is the instance, and unmounting destroys it', async () => {
    const instance = ref<{ field: CronFieldInstance | null } | null>(null)
    const container = document.body.appendChild(document.createElement('div'))
    const listeners = trackListeners()
    const app = createApp(() => h(CronField, { ref: instance, modelValue: '0 9 * * 1-5' }))

    app.mount(container)
    assert.equal(instance.value?.field?.value, '0 9 * * 1-5')

    instance.value?.field?.setValue('15 10 * * *')
    assert.equal(tokens(container), '15 10 * * *')
    assert.ok(listeners.attached().includes('pointerdown'))

    app.unmount()
    listeners.stop()
    assert.equal(container.innerHTML, '')
    assert.deepEqual(listeners.attached(), [])
})
