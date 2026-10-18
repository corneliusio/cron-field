/*
 * <cron-field>: seeding from markup, form value, events, validity, reset and restore, attributes and properties,
 * labels, disabling and registration. happy-dom has no ElementInternals, so `internals.ts` stands in for the form's
 * side; the browser's own form wiring (FormData, :invalid, fieldsets, label activation) stays a manual check.
 */
import '../support/dom.ts'
import '../support/internals.ts'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Cron } from 'croner'
import { croner } from '../../src/adapters/croner.ts'
import { CronFieldElement, defineCronField } from '../../src/element/index.ts'
import { chip, find, key, mouseClick, sameNode, tick, tokens, typeInto } from '../support/dom.ts'
import { internalsOf } from '../support/internals.ts'

defineCronField()

afterEach(() => document.body.replaceChildren())

/** The fields the element has chips for, shown or not: a value the target can't read hides them for Edit as cron. */
const fieldsOf = (element: Element) => [...element.querySelectorAll<HTMLElement>('button[data-field]')].map(button => button.dataset.field).join(' ')
const page = (html: string) => {
    const template = document.createElement('template')

    // happy-dom's innerHTML connects a custom element before parsing its children; browsers' innerHTML parses them first.
    template.innerHTML = html
    document.body.replaceChildren(template.content)

    const element = document.querySelector('cron-field')

    assert.ok(element)

    return element
}
/** Every input and change event that reaches the document, with what it targeted. */
const listen = () => {
    const events: string[] = []
    const record = (event: Event) =>
        events.push(`${event.type} ${(event.target as Element).localName}${event instanceof CustomEvent ? ` ${event.detail.value}` : ''}`)

    document.addEventListener('input', record)
    document.addEventListener('change', record)

    return events
}

test('the fallback input seeds the value and name on first connection; the value attribute wins, and a moved element keeps its edits', () => {
    const element = page('<form><cron-field><input name="schedule" value="0 9 * * 1-5"></cron-field></form>')

    assert.deepEqual([element.value, element.name, tokens(element)], ['0 9 * * 1-5', 'schedule', '0 9 * * 1-5'])
    sameNode(element.querySelector('input[name="schedule"]'), null, 'the field replaces the fallback')

    const attributed = page('<cron-field value="15 10 * * *"><input name="schedule" value="0 9 * * 1-5"></cron-field>')

    assert.equal(attributed.value, '15 10 * * *')

    key(chip(attributed, 'hour'), 'Backspace')
    attributed.remove()
    document.body.append(attributed)
    assert.deepEqual([attributed.value, tokens(attributed)], ['15 * * * *', '15 * * * *'])
})

test('a value set before connection, or even before the element is defined, survives', () => {
    const detached = document.createElement('cron-field')

    detached.value = '5 5 * * *'
    document.body.append(detached)
    assert.deepEqual([detached.value, tokens(detached)], ['5 5 * * *', '5 5 * * *'])

    // A framework can set the property on an element in the page before the definition loads.
    const early = document.body.appendChild(document.createElement('cron-early'))

    Object.assign(early, { value: '6 6 * * *' })
    defineCronField('cron-early')
    assert.ok(early instanceof CronFieldElement)
    assert.equal(Object.hasOwn(early, 'value'), false, 'the own property no longer hides the accessor')
    assert.deepEqual([early.value, tokens(early), internalsOf(early).value], ['6 6 * * *', '6 6 * * *', '6 6 * * *'])
})

test('the form value follows connection, every commit and every programmatic set', () => {
    const element = page('<form><cron-field name="schedule" value="0 9 * * 1-5"></cron-field></form>')

    assert.equal(internalsOf(element).value, '0 9 * * 1-5')

    key(chip(element, 'hour'), 'Backspace')
    assert.equal(internalsOf(element).value, '0 * * * 1-5')

    element.value = '15 10 * * *'
    assert.equal(internalsOf(element).value, '15 10 * * *')

    element.setAttribute('value', '30 6 * * *')
    assert.equal(internalsOf(element).value, '30 6 * * *')
})

test('each committed value fires one input and one change from the element; inner controls and programmatic sets fire nothing', () => {
    const element = page('<form><cron-field value="0 9 * * 1-5"></cron-field></form>')
    const events = listen()

    find(element, '[data-part="mode-toggle"]').click()
    typeInto(find<HTMLInputElement>(element, '[data-part="input"]'), '0 9 * * 1-4')
    assert.deepEqual(events.splice(0), ['input cron-field', 'change cron-field 0 9 * * 1-4'])

    // Escape puts back the value from before editing, which is a change too.
    key(find(element, '[data-part="input"]'), 'Escape')
    assert.deepEqual(events.splice(0), ['input cron-field', 'change cron-field 0 9 * * 1-5'])

    // A menu's own text input applies only on Enter.
    mouseClick(chip(element, 'minute'))
    typeInto(find<HTMLInputElement>(element, '[data-part="custom-input"]'), '30')

    element.value = '15 10 * * *'
    element.setAttribute('value', '30 6 * * *')
    assert.deepEqual(events, [])
})

test('validity carries the message and points at the first chip, or at the text input in Edit as cron', async () => {
    const element = page('<form><cron-field value="5/15 * * * *"></cron-field></form>')

    assert.deepEqual(
        [element.validity.valid, element.validity.customError, element.validationMessage, element.checkValidity()],
        [false, true, 'Minutes: 5/15 needs a range to step through: 5-59/15.', false],
    )
    sameNode(internalsOf(element).anchor, chip(element, 'minute'))

    find(element, '[data-part="mode-toggle"]').click()
    // Edit as cron shows through an attribute, which the element observes.
    await tick()
    sameNode(internalsOf(element).anchor, find(element, '[data-part="input"]'))

    element.value = '0 9 * * 1-5'
    assert.deepEqual([element.validity.valid, element.validationMessage], [true, ''])

    // A target that can't read the value makes it invalid with no change to the value.
    element.setAttribute('target', 'quartz')
    assert.deepEqual([element.validity.valid, element.validationMessage], [false, 'Quartz needs 6 fields. This has 5.'])
})

test('a form reset puts back the default without blanking the text input or firing events', async () => {
    const element = page('<form><cron-field name="schedule" value="0 9 * * 1-5"></cron-field></form>')
    const form = find<HTMLFormElement>(document, 'form')
    const input = find<HTMLInputElement>(element, '[data-part="input"]')

    key(chip(element, 'hour'), 'Backspace')

    const events = listen()

    form.reset()
    await tick()
    assert.deepEqual([element.value, internalsOf(element).value, input.value, tokens(element)], Array(4).fill('0 9 * * 1-5'))
    assert.deepEqual(events, [])
})

test('a restored form state applies a string and ignores anything else', () => {
    const element = page('<cron-field value="0 9 * * 1-5"></cron-field>')

    element.formStateRestoreCallback('15 10 * * *')
    element.formStateRestoreCallback(null)
    assert.equal(element.value, '15 10 * * *')
})

test('attributes set the target, clock, locale, week start, chip width and label, and ignore values they can’t read', () => {
    const element = page('<cron-field value="0 9 * * 1-5" hourcycle="h23" labelledby="outside"></cron-field>')
    const chips = find(element, '[data-part="chips"]')
    const days = () => {
        chip(element, 'weekday').click()

        const names = [...element.querySelectorAll('[data-part="day-toggle"]')].map(toggle => toggle.getAttribute('aria-label')?.slice(0, 2))

        key(chip(element, 'weekday'), 'Escape')

        return names.join(' ')
    }

    assert.equal(element.status?.description, 'At 09:00 on weekdays.')
    assert.equal(chips.getAttribute('aria-labelledby'), 'outside')

    element.setAttribute('hourcycle', 'h99')
    assert.equal(element.status?.description, 'At 9:00 AM on weekdays.')

    element.setAttribute('locale', 'de')
    assert.equal(days(), 'Mo Di Mi Do Fr Sa So')
    assert.equal(element.status?.description, 'At 09:00 on weekdays.', 'the locale brings its own clock')

    element.setAttribute('weekstart', '0')
    assert.equal(days(), 'So Mo Di Mi Do Fr Sa')

    element.setAttribute('weekstart', '9')
    assert.equal(days(), 'Mo Di Mi Do Fr Sa So')

    element.setAttribute('chipwidth', 'equal')
    assert.equal(chips.dataset.chipWidth, 'equal')

    element.setAttribute('label', 'Runs')
    assert.equal(find(element, '[data-part="label"]').textContent, 'Runs')
    assert.notEqual(chips.getAttribute('aria-labelledby'), 'outside', 'a label of its own wins over labelledby')

    element.setAttribute('target', 'quartz')
    assert.equal(fieldsOf(element), 'second minute hour day month weekday')
})

test('properties carry the options attributes can’t: an adapter target, presets, describe, translation and parts', () => {
    const element = page('<cron-field value="0 9 * * 1-5" target="cloudflare"></cron-field>')

    // Cloudflare counts Sunday as 1 and runs in UTC; croner counts it as 0.
    assert.equal(element.status?.description, 'At 9:00 AM, Sunday through Thursday (UTC).')

    element.target = croner(Cron)
    assert.equal(element.status?.description, 'At 9:00 AM on weekdays.', 'the property wins over the attribute')

    element.target = undefined
    assert.equal(element.status?.description, 'At 9:00 AM, Sunday through Thursday (UTC).')

    element.presets = { hour: ['*', '12'] }
    chip(element, 'hour').click()
    assert.deepEqual(
        [...element.querySelectorAll('[data-part="preset"]')].map(preset => preset.textContent),
        ['Every hour', 'At 12 PM'],
    )

    element.describe = value => `Runs ${value}`
    assert.equal(find(element, '[data-part="message"]').textContent, 'Runs 0 9 * * 1-5')

    element.translateMessage = ({ id }) => id
    assert.equal(find(element, '[data-part="mode-toggle"]').textContent, 'ui.editAsCron')

    element.parts = { chip: { className: 'pill' } }
    assert.ok(chip(element, 'hour').classList.contains('pill'))
})

test('a label for the element names the chips, and clicking or focusing the element focuses the first chip, or the input in Edit as cron', () => {
    const element = page('<label for="when">When</label><cron-field id="when" value="0 9 * * 1-5"></cron-field>')
    const label = find(document, 'label')

    assert.ok(label.id, 'a label without an id gets one')
    assert.equal(find(element, '[data-part="chips"]').getAttribute('aria-labelledby'), label.id)

    // A label's activation clicks the element itself.
    element.click()
    sameNode(document.activeElement, chip(element, 'minute'))

    find(element, '[data-part="mode-toggle"]').focus()
    element.focus()
    sameNode(document.activeElement, chip(element, 'minute'))

    const named = page('<label id="mine" for="when">When</label><cron-field id="when" value="0 9 * *"></cron-field>')

    assert.equal(find(named, '[data-part="input"]').getAttribute('aria-labelledby'), 'mine')

    named.click()
    sameNode(document.activeElement, find(named, '[data-part="input"]'))
})

test('the disabled attribute disables the chips, toggle and input, and a disabled fieldset does once the browser reports it', () => {
    const element = page('<form><fieldset><cron-field value="0 9 * * 1-5" disabled></cron-field></fieldset></form>')
    const controls = () =>
        [...element.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-part="chip"], [data-part="mode-toggle"], [data-part="input"]')].map(
            control => control.disabled,
        )

    assert.equal(controls().length, 7)
    assert.ok(controls().every(Boolean))

    element.disabled = false
    assert.ok(!controls().some(Boolean))

    find<HTMLFieldSetElement>(document, 'fieldset').disabled = true
    element.formDisabledCallback()
    assert.ok(controls().every(Boolean))
})

test('defining the element twice is harmless, and another tag gets a class of its own', () => {
    const defined = customElements.get('cron-field')

    defineCronField()
    defineCronField('cron-schedule')

    const other = customElements.get('cron-schedule')

    assert.equal(customElements.get('cron-field'), defined)
    assert.ok(other && other !== defined && other.prototype instanceof CronFieldElement)

    document.body.append(Object.assign(document.createElement('cron-schedule'), { value: '0 9 * * 1-5' }))
    assert.equal(tokens(document.body), '0 9 * * 1-5')
})
