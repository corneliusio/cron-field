/*
 * happy-dom has no ElementInternals: a stand-in that records what <cron-field> tells its form, and the parts of
 * form association browsers do for it. Element tests only; import it after `dom.ts`.
 */
import assert from 'node:assert/strict'

export type FormRecord = { value: unknown; flags: ValidityStateFlags; message: string; anchor: HTMLElement | undefined }

const records = new WeakMap<Element, FormRecord>()
const matches = Element.prototype.matches
const reset = HTMLFormElement.prototype.reset

/** What the element last told its form: the submitted value, and validity with its anchor. */
export const internalsOf = (element: Element) => {
    const record = records.get(element)

    if (!record) {
        throw new Error(`${element.tagName} has no internals`)
    }

    return record
}

const attach = (element: HTMLElement) => {
    const record: FormRecord = { value: null, flags: {}, message: '', anchor: undefined }
    const internals: Partial<ElementInternals> = {
        get form() {
            return element.closest('form')
        },
        get labels() {
            return document.querySelectorAll(`label[for="${element.id}"]`)
        },
        get validity() {
            return { ...record.flags, valid: !record.flags.customError } as ValidityState
        },
        get validationMessage() {
            return record.message
        },
        setFormValue(value) {
            record.value = value
        },
        setValidity(flags = {}, message = '', anchor) {
            Object.assign(record, { flags, message, anchor })
        },
        checkValidity: () => !record.flags.customError,
        reportValidity: () => !record.flags.customError,
    }

    records.set(element, record)

    return internals as ElementInternals
}

assert.ok(!Reflect.has(HTMLElement.prototype, 'attachInternals'), 'happy-dom has ElementInternals now: this stand-in can go.')

HTMLElement.prototype.attachInternals = function () {
    return attach(this)
}

// Browsers match :disabled on a form-associated element for its own attribute or a disabled fieldset; happy-dom only on native controls.
Element.prototype.matches = function (this: Element, selectors: string) {
    return selectors === ':disabled' && records.has(this)
        ? this.hasAttribute('disabled') || !!this.closest('fieldset[disabled]')
        : matches.call(this, selectors)
} as Element['matches']

// Browsers reset the form's own controls first, then call formResetCallback on its form-associated elements.
HTMLFormElement.prototype.reset = function () {
    reset.call(this)

    for (const element of this.querySelectorAll<HTMLElement & { formResetCallback?: () => void }>('*')) {
        if (records.has(element)) {
            element.formResetCallback?.()
        }
    }
}
