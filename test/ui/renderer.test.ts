/*
 * The plain-DOM field as a user drives it: chips, menus, Edit as cron, messages, forms and options. Popovers are
 * shimmed and happy-dom has no layout, so menus and labels are checked for being open, not for where they sit.
 */
import '../support/dom.ts'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Cron } from 'croner'
import { croner } from '../../src/adapters/croner.ts'
import { createCronField, formatMessage, type ChangeDetail, type CronFieldInstance, type CronFieldOptions } from '../../src/index.ts'
import { chip, find, key, mouseClick, sameNode, tick, tokens, trackListeners, typeInto } from '../support/dom.ts'

const fields: CronFieldInstance[] = []
const active = () => document.activeElement as HTMLElement
const menuOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-part="menu"]')
const shownLabels = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLElement>('[data-part="chip-label"]')]
        .filter(label => label.matches(':popover-open'))
        .map(label => label.closest<HTMLElement>('[data-field]')?.dataset.field)
const mount = (options: CronFieldOptions = {}) => {
    const form = document.createElement('form')
    const root = document.createElement('div')

    form.append(root)
    document.body.append(form)

    const field = createCronField(root, options)

    fields.push(field)

    return { form, root, field }
}

afterEach(() => {
    fields.splice(0).forEach(field => field.destroy())
    document.body.replaceChildren()
})

test('the field shows a chip per target field, in order, and submits its value only when it has a name', () => {
    const { form, root } = mount({ value: '0 30 9 ? * MON-FRI', target: 'quartz', name: 'schedule' })
    const chips = [...root.querySelectorAll<HTMLElement>('[data-part="chip"]')].map(element => [
        element.dataset.field,
        find(element, '[data-part="token"]').textContent,
        element.getAttribute('aria-label'),
    ])

    assert.deepEqual(chips, [
        ['second', '0', 'Seconds: 0'],
        ['minute', '30', 'Minutes: 30'],
        ['hour', '9', 'Hours: 9'],
        ['day', '?', 'Day of month: ?'],
        ['month', '*', 'Months: *'],
        ['weekday', 'MON-FRI', 'Day of week: MON-FRI'],
    ])
    assert.deepEqual([...new FormData(form)], [['schedule', '0 30 9 ? * MON-FRI']])

    const unnamed = mount({ value: '0 9 * * *' })

    assert.deepEqual([...new FormData(unnamed.form)], [])
})

test('ArrowDown opens a chip’s menu on the preset in effect; arrows cycle the presets and Escape returns to the chip', () => {
    const { root } = mount({ value: '0 9 * * 1-5' })
    const hour = chip(root, 'hour')

    hour.focus()
    key(hour, 'ArrowDown')

    const menu = find(root, '[data-part="menu"]')

    assert.equal(hour.getAttribute('aria-expanded'), 'true')
    assert.equal(hour.getAttribute('aria-controls'), menu.id)
    assert.ok(menu.matches(':popover-open'))
    // Hour presets: every hour, 9 AM to 5 PM, every other hour, 9 AM.
    assert.equal(active().dataset.key, 'preset:0:3')
    assert.equal(active().getAttribute('aria-current'), 'true')

    key(active(), 'ArrowDown')
    assert.equal(active().dataset.key, 'preset:0:0', 'ArrowDown wraps to the first preset')

    key(active(), 'ArrowUp')
    assert.equal(active().dataset.key, 'preset:0:3', 'ArrowUp wraps to the last preset')

    key(active(), 'Escape')
    sameNode(menuOf(root), null)
    sameNode(active(), hour)
    assert.equal(hour.getAttribute('aria-expanded'), 'false')
})

test('a mouse click opens a chip’s menu ready to type, a keyboard click on the preset in effect, and a click on the open chip closes it', () => {
    const { root } = mount({ value: '0 9 * * 1-5' })
    const minute = chip(root, 'minute')

    mouseClick(minute)

    const input = active() as HTMLInputElement

    assert.equal(input.dataset.part, 'custom-input')
    assert.deepEqual([input.value, input.selectionStart, input.selectionEnd], ['0', 0, 1], 'the token is selected, so typing replaces it')

    mouseClick(minute)
    sameNode(menuOf(root), null)

    // A key press clicks with no pointer type and detail 0.
    minute.click()
    assert.equal(active().dataset.part, 'preset')
    assert.equal(active().getAttribute('aria-current'), 'true')
})

test('picking a preset sets the value and reports it once, and the open menu keeps focus on that preset', () => {
    const changes: [string, ChangeDetail][] = []
    const { root, field } = mount({ value: '0 9 * * 1-5', onChange: (value, detail) => changes.push([value, detail]) })

    key(chip(root, 'hour'), 'ArrowDown')

    const menu = find(root, '[data-part="menu"]')
    const everyOther = find(menu, '[data-key="preset:0:2"]')

    everyOther.focus()
    everyOther.click()

    assert.equal(field.value, '0 */2 * * 1-5')
    assert.equal(changes.length, 1)
    assert.deepEqual(
        changes.map(([value, { valid, description }]) => ({ value, valid, description })),
        [{ value: '0 */2 * * 1-5', valid: true, description: 'Every other hour, on the hour, on weekdays.' }],
    )
    sameNode(menuOf(root), menu, 'the same menu stays open')
    assert.ok(menu.matches(':popover-open'))
    assert.equal(active().dataset.key, 'preset:0:2')
    assert.equal(active().getAttribute('aria-current'), 'true')
    assert.equal(tokens(root), '0 */2 * * 1-5')
})

test('a menu’s text input flags a token its field can’t read and applies a valid one on Enter', () => {
    const { root, field } = mount({ value: '0 9 * * 1-5' })

    mouseClick(chip(root, 'minute'))

    const input = active() as HTMLInputElement
    const hint = find(root, `#${input.getAttribute('aria-describedby')}`)

    typeInto(input, '61')
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.equal(hint.textContent, '61 is out of range. Minutes go from 0 to 59.')

    key(input, 'Enter')
    assert.equal(field.value, '0 9 * * 1-5', 'Enter does not apply an invalid token')

    typeInto(input, '15')
    assert.equal(input.hasAttribute('aria-invalid'), false)
    assert.equal(hint.textContent, 'Press Enter to apply.')

    key(input, 'Enter')
    assert.equal(field.value, '15 9 * * 1-5')
})

test('the Days menu toggles weekdays, writes occurrence rules, and clears one day field at a time where the target reads occurrences', () => {
    const { root, field } = mount({ value: '0 9 1,15 * 1-5', target: croner(Cron) })

    chip(root, 'weekday').click()

    const menu = find(root, '[data-part="menu"]')
    const pressed = (day: number) => find(menu, `[data-key="dow:${day}"]`).getAttribute('aria-pressed')

    assert.equal(menu.getAttribute('aria-label'), 'Days')
    assert.equal(pressed(5), 'true')

    find(menu, '[data-key="dow:5"]').click()
    assert.equal(field.value, '0 9 1,15 * 1-4')
    assert.equal(pressed(5), 'false')

    // A day not picked yet counts as Monday.
    const which = find<HTMLSelectElement>(menu, '[data-key="nth:k"]')

    which.value = '2'
    which.dispatchEvent(new Event('change'))
    assert.equal(field.value, '0 9 1,15 * 1#2')

    find(menu, '[data-key="clear:0"]').click()
    assert.equal(field.value, '0 9 * * 1#2', 'Clear empties only the day of month')
    assert.equal(active().closest<HTMLElement>('[data-section-field]')?.dataset.sectionField, 'day')
    assert.equal(active().getAttribute('aria-current'), 'true', 'focus moves to the preset now in effect')

    // Vixie cron reads no occurrence rules, so each day field has its own menu.
    const vixie = mount({ value: '0 9 1,15 * 1-5' })

    chip(vixie.root, 'day').click()
    assert.equal(menuOf(vixie.root)?.getAttribute('aria-label'), 'Day of month')

    chip(vixie.root, 'weekday').click()
    assert.equal(menuOf(vixie.root)?.getAttribute('aria-label'), 'Day of week')
    sameNode(vixie.root.querySelector('[data-part="nth"]'), null)
})

test('a press outside the field or focus moving away closes the menu; a press on the chips does not', () => {
    const { root } = mount({ value: '0 9 * * 1-5' })
    const outside = document.body.appendChild(document.createElement('button'))
    const press = (element: Element) => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

    key(chip(root, 'hour'), 'ArrowDown')
    press(chip(root, 'minute'))
    press(find(root, '[data-part="preset"]'))
    assert.ok(menuOf(root)?.matches(':popover-open'))

    press(outside)
    sameNode(menuOf(root), null)

    key(chip(root, 'hour'), 'ArrowDown')
    outside.focus()
    sameNode(menuOf(root), null)
})

test('arrow keys move along the chips and stop at the ends; Backspace and Delete clear a field but never seconds or minutes', () => {
    const { root, field } = mount({ value: '0 30 9 1 6 1-5', target: croner(Cron, { parts: 6 }) })
    const walk = (name: string, times: number) => {
        for (let i = 0; i < times; i++) {
            key(active(), name)
        }

        return active().dataset.field
    }

    chip(root, 'second').focus()
    assert.equal(walk('ArrowLeft', 1), 'second')
    assert.equal(walk('ArrowRight', 3), 'day')
    assert.equal(walk('ArrowRight', 5), 'weekday')

    key(chip(root, 'second'), 'Backspace')
    key(chip(root, 'minute'), 'Delete')
    assert.equal(field.value, '0 30 9 1 6 1-5')

    key(chip(root, 'hour'), 'Backspace')
    key(chip(root, 'day'), 'Delete')
    key(chip(root, 'month'), 'Backspace')
    key(chip(root, 'weekday'), 'Delete')
    assert.equal(field.value, '0 30 * * * *')
})

test('Edit as cron commits each new draft once, keeps a draft of the wrong shape open, and Escape puts back the value from before', () => {
    const changes: string[] = []
    const { root, field } = mount({ value: '0 9 * * 1-5', onChange: value => changes.push(value) })
    const toggle = find(root, '[data-part="mode-toggle"]')
    const input = find<HTMLInputElement>(root, '[data-part="input"]')
    const box = find(root, '[data-part="box"]')

    toggle.click()
    sameNode(active(), input)
    assert.deepEqual([input.hidden, box.hidden, toggle.textContent], [false, true, 'Done'])

    typeInto(input, '0 9 * *')
    typeInto(input, ' 0 9  * * ')
    assert.deepEqual(changes, ['0 9 * *'], 'the same schedule spaced differently is no change')

    key(input, 'Enter')
    toggle.click()
    sameNode(active(), input, 'Enter and Done keep a draft with the wrong field count')
    assert.equal(find(root, '[data-part="message"]').textContent, 'Cron needs 5 fields. This has 4.')

    key(input, 'Escape')
    assert.equal(field.value, '0 9 * * 1-5')
    assert.deepEqual([input.hidden, box.hidden, tokens(root)], [true, false, '0 9 * * 1-5'])
    sameNode(active(), toggle)

    // A value set from outside while editing is what Escape returns to.
    toggle.click()
    field.setValue('15 10 * * *')
    typeInto(input, '1 2 3')
    key(input, 'Escape')
    assert.equal(field.value, '15 10 * * *')
})

test('defaultMode cron opens the field in Edit as cron, and only when it is created', () => {
    const { root, field } = mount({ value: '0 9 * * 1-5', defaultMode: 'cron' })
    const toggle = find(root, '[data-part="mode-toggle"]')
    const input = find<HTMLInputElement>(root, '[data-part="input"]')

    assert.deepEqual([input.hidden, input.value, toggle.textContent], [false, '0 9 * * 1-5', 'Done'])

    toggle.click()
    assert.equal(input.hidden, true)

    field.setOptions({ defaultMode: 'chips' })
    field.setOptions({ defaultMode: 'cron' })
    assert.equal(input.hidden, true)
})

test('Escape back to a value that still needs Edit as cron shows that value in the input', () => {
    const { root, field } = mount({ value: '' })
    const input = find<HTMLInputElement>(root, '[data-part="input"]')

    input.focus()
    typeInto(input, '0 9 * *')
    key(input, 'Escape')
    assert.equal(field.value, '')
    assert.equal(input.value, '')
})

test('a message’s fix applies its change and focuses the chip, or the input in Edit as cron', () => {
    const { root, field } = mount({ value: '5/15 * * * *' })
    const fixButton = () => find(root, '[data-part="fix"]')

    assert.equal(find(root, '[data-part="message"]').textContent, 'Minutes: 5/15 needs a range to step through: 5-59/15. Use 5-59/15')
    assert.ok(root.hasAttribute('data-invalid'))

    fixButton().click()
    assert.equal(field.value, '5-59/15 * * * *')
    sameNode(active(), chip(root, 'minute'))
    assert.equal(root.hasAttribute('data-invalid'), false)

    find(root, '[data-part="mode-toggle"]').click()
    typeInto(find<HTMLInputElement>(root, '[data-part="input"]'), '0 5/15 * * *')
    // A real press moves focus to the button first.
    fixButton().focus()
    fixButton().click()
    assert.equal(field.value, '0 5-23/15 * * *')
    sameNode(active(), find(root, '[data-part="input"]'))
    assert.equal(find<HTMLInputElement>(root, '[data-part="input"]').value, '0 5-23/15 * * *')
})

test('a form reset puts back the first value when the field submits with the form, else keeps its value, never leaves the input blank, and restores the mode', async () => {
    for (const [name, expected] of [
        ['schedule', '0 9 * * 1-5'],
        [undefined, '15 10 * * *'],
    ] as const) {
        const { form, root, field } = mount({ value: '0 9 * * 1-5', name })
        const input = find<HTMLInputElement>(root, '[data-part="input"]')

        field.setValue('15 10 * * *')
        form.reset()
        // A submit straight after the reset sends the restored value.
        assert.equal(new FormData(form).get('schedule'), name ? expected : null, `name: ${name}`)
        await tick()
        assert.equal(field.value, expected, `name: ${name}`)
        assert.equal(input.value, expected, `name: ${name}`)
        assert.equal(tokens(root), expected, `name: ${name}`)
    }

    // The mode goes back to how the field opened.
    const { form, root } = mount({ value: '0 9 * * 1-5', defaultMode: 'cron' })

    find(root, '[data-part="mode-toggle"]').click()
    assert.ok(!root.hasAttribute('data-raw'))
    form.reset()
    await tick()
    assert.ok(root.hasAttribute('data-raw'))

    // A reset that a handler cancels changes nothing.
    const cancelled = mount({ value: '0 9 * * 1-5', name: 'schedule' })

    cancelled.field.setValue('15 10 * * *')
    cancelled.form.addEventListener('reset', event => event.preventDefault())
    cancelled.form.reset()
    await tick()
    assert.equal(cancelled.field.value, '15 10 * * *')
})

test('setOptions re-describes a value that fits the new target, switches to Edit as cron when it doesn’t, and leaves an open menu alone when nothing shows a change', () => {
    const { root, field } = mount({ value: '0 9 * * 1', target: croner(Cron) })

    assert.equal(field.status.description, 'At 9:00 AM on Mondays.')

    // Cloudflare counts Sunday as 1 and runs in UTC.
    field.setOptions({ target: 'cloudflare' })
    assert.equal(field.value, '0 9 * * 1')
    assert.equal(field.status.description, 'At 9:00 AM on Sundays (UTC).')

    // Wrappers pass every option again with a new adapter object on each render.
    field.setOptions({ target: croner(Cron) })
    key(chip(root, 'hour'), 'ArrowDown')

    const menu = menuOf(root)
    const focused = active()

    field.setOptions({ target: croner(Cron), label: undefined })
    sameNode(menuOf(root), menu)
    sameNode(active(), focused)

    field.setOptions({ label: 'Runs' })
    assert.equal(find(root, '[data-part="label"]').textContent, 'Runs')

    field.setOptions({ label: undefined })
    assert.equal(find(root, '[data-part="label"]').textContent, 'Schedule')

    field.setOptions({ target: 'quartz' })
    sameNode(menuOf(root), null)
    assert.ok(root.hasAttribute('data-raw'))
    assert.equal(find(root, '[data-part="message"]').textContent, 'Quartz needs 6 fields. This has 5.')

    // Edit as cron that a target forced closes once the value fits again; one the user opened stays open.
    field.setOptions({ target: 'vixie' })
    assert.ok(!root.hasAttribute('data-raw'))

    find(root, '[data-part="mode-toggle"]').click()
    field.setOptions({ target: 'quartz' })
    field.setOptions({ target: 'vixie' })
    assert.ok(root.hasAttribute('data-raw'))
})

test('setOptions shows new presets in an open menu: lists by content, functions by identity', () => {
    const { root, field } = mount({ value: '0 9 * * *', presets: { hour: () => [{ token: '9', label: 'Old' }] } })
    const labels = () => [...root.querySelectorAll('[data-part="preset"]')].map(preset => preset.textContent)

    key(chip(root, 'hour'), 'ArrowDown')
    assert.deepEqual(labels(), ['Old'])

    field.setOptions({ presets: { hour: () => [{ token: '17', label: 'New' }] } })
    assert.deepEqual(labels(), ['New'])

    field.setOptions({ presets: { hour: ['12'] } })
    field.setOptions({ presets: { hour: ['12'] } })
    assert.deepEqual(labels(), ['At 12 PM'])
})

test('a disabled field closes its menu, ignores presets and keys, and drops out of the form', () => {
    const { form, root, field } = mount({ value: '0 9 * * 1-5', name: 'schedule' })

    key(chip(root, 'hour'), 'ArrowDown')

    const preset = find(root, '[data-key="preset:0:0"]')

    field.setOptions({ disabled: true })
    sameNode(menuOf(root), null)
    assert.ok([...root.querySelectorAll<HTMLButtonElement>('button[data-field]')].every(button => button.disabled))
    assert.ok(find<HTMLButtonElement>(root, '[data-part="mode-toggle"]').disabled)
    assert.ok(find<HTMLInputElement>(root, '[data-part="input"]').disabled)
    assert.deepEqual([...new FormData(form)], [])

    preset.click()
    key(chip(root, 'hour'), 'Backspace')
    key(chip(root, 'hour'), 'ArrowDown')
    assert.equal(field.value, '0 9 * * 1-5')
    sameNode(menuOf(root), null)
})

test('one chip label shows at a time, for the hovered chip or else the focused one, until Escape hushes it', () => {
    const { root } = mount({ value: '0 9 * * 1-5' })
    const hover = (field: 'minute' | 'hour', type: 'pointerenter' | 'pointerleave') =>
        chip(root, field).dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }))

    chip(root, 'minute').focus()
    assert.deepEqual(shownLabels(root), ['minute'])

    hover('hour', 'pointerenter')
    assert.deepEqual(shownLabels(root), ['hour'], 'the pointer wins over focus')

    hover('hour', 'pointerleave')
    assert.deepEqual(shownLabels(root), ['minute'])

    key(chip(root, 'minute'), 'Escape')
    assert.deepEqual(shownLabels(root), [])

    // Hushed until focus leaves the chip.
    chip(root, 'hour').focus()
    chip(root, 'minute').focus()
    assert.deepEqual(shownLabels(root), ['minute'])

    // The menu's text input speaks for its chip, and the label follows what it applies.
    mouseClick(chip(root, 'hour'))
    assert.deepEqual(shownLabels(root), ['hour'])

    const label = find(chip(root, 'hour'), '[data-part="chip-label"]')

    assert.equal(label.textContent, 'At 9 AM')

    typeInto(active() as HTMLInputElement, '9-17')
    key(active(), 'Enter')
    assert.equal(label.textContent, '9 AM–5 PM')
})

test('a translate function reaches every text and label the field and its Days menu show', () => {
    const { root } = mount({
        value: '0 9 1,15 * 1-5',
        target: croner(Cron),
        translate: ({ template, params }) => `[${formatMessage(template, params)}]`,
    })

    chip(root, 'weekday').click()

    // Cron tokens are the value itself, and weekday names come from the locale.
    const names = new Set(
        (['long', 'narrow'] as const).flatMap(weekday =>
            [5, 6, 7, 8, 9, 10, 11].map(day => new Date(Date.UTC(2026, 0, day)).toLocaleDateString('en', { weekday, timeZone: 'UTC' })),
        ),
    )
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const texts: string[] = []

    while (walker.nextNode()) {
        if (!walker.currentNode.parentElement?.closest('[data-part="token"]')) {
            texts.push(walker.currentNode.textContent ?? '')
        }
    }

    const labels = [...root.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label') ?? '')
    const untranslated = [...texts, ...labels].filter(text => text.trim() && !/^\[.*\]$/s.test(text) && !names.has(text))

    assert.ok(menuOf(root)?.querySelector('[data-part="nth"]'), 'the Days menu is open')
    assert.deepEqual(untranslated, [])
})

test('destroy empties the root and removes every listener the field added to the page', async () => {
    const listeners = trackListeners()
    const changes: string[] = []
    const { form, root, field } = mount({ value: '0 9 * * 1-5', name: 'schedule', onChange: value => changes.push(value) })

    key(chip(root, 'hour'), 'ArrowDown')
    // The open menu follows scrolling and resizing.
    assert.deepEqual(listeners.attached(), ['focusin', 'focusout', 'keydown', 'pointerdown', 'reset', 'resize', 'scroll'])

    field.destroy()
    listeners.stop()
    assert.deepEqual(listeners.attached(), [])
    assert.deepEqual([root.childNodes.length, root.className, root.hasAttribute('data-part')], [0, '', false])

    key(document.body, 'Escape')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    form.reset()
    await tick()
    assert.equal(root.childNodes.length, 0)
    assert.deepEqual(changes, [])
})
