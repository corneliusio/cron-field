/*
 * <cron-field>: the field as a form-associated custom element, for plain HTML and server-rendered pages.
 * It submits its value with forms, resets with them, and reports validity, so `:invalid` and
 * `form.checkValidity()` work. Light DOM, so the stylesheets apply as anywhere else.
 *
 *     <cron-field name="schedule" value="0 9 * * 1-5" target="github"><input name="schedule" value="0 9 * * 1-5"></cron-field>
 *
 * A child input is the fallback before the script loads; the element takes its name and value.
 * Attributes: value, target, label, labelledby, name, disabled, timezone, hourcycle, locale, weekstart, chipwidth, defaultmode. Adapter targets,
 * `describe`, `parts`, `presets` and `translateMessage` (the `translate` option) are properties.
 */
import type { TargetInput } from '../core/target.ts'
import type { TargetName } from '../core/targets.ts'
import { createCronField, type ChangeDetail, type CronFieldInstance, type CronFieldOptions } from '../dom/create.ts'
import type { HourCycle } from '../i18n/locale.ts'
import { translator } from '../i18n/translate.ts'
import type { Status } from '../model/messages.ts'

/** Options set as properties rather than attributes. */
type Extra = Pick<CronFieldOptions, 'describe' | 'parts' | 'presets' | 'translate' | 'target'>

const HOUR_CYCLES: HourCycle[] = ['h11', 'h12', 'h23', 'h24']
const ATTRIBUTES = ['value', 'target', 'label', 'labelledby', 'name', 'disabled', 'timezone', 'hourcycle', 'locale', 'weekstart', 'chipwidth'] as const
const PROPERTIES = ['value', 'target', 'describe', 'translateMessage', 'parts', 'presets', 'disabled', 'name'] as const

export class CronFieldElement extends HTMLElement {
    static formAssociated = true
    static observedAttributes = ATTRIBUTES

    #internals = this.attachInternals()
    #field: CronFieldInstance | null = null
    #value = ''
    #default = ''
    #started = false
    #assigned = false
    #extra: Extra = {}

    // Raw mode hides the chips or the input, so validity has to point at the other one.
    #modes = new MutationObserver(() => this.#sync())

    constructor() {
        super()
        // A <label for> clicks the element itself; take that to the field, as a label does for an input.
        this.addEventListener('click', event => {
            if (event.target === this) {
                this.focus()
            }
        })

        // The inner inputs' own events stay inside: the element fires one input and one change per committed value.
        for (const type of ['input', 'change']) {
            this.addEventListener(type, event => {
                if (event.target !== this) {
                    event.stopPropagation()
                }
            })
        }

        // A property set before the element was defined is the element's own and hides the accessor, so set it again through the accessor.
        for (const key of PROPERTIES) {
            if (Object.hasOwn(this, key)) {
                const value: unknown = Reflect.get(this, key)

                Reflect.deleteProperty(this, key)
                Reflect.set(this, key, value)
            }
        }
    }

    get value() {
        return this.#field?.value ?? this.#value
    }

    set value(next: string) {
        this.#assigned = true
        this.#value = next
        this.#field?.setValue(next)
        this.#sync()
    }

    get name() {
        return this.getAttribute('name') ?? ''
    }

    set name(name: string) {
        this.setAttribute('name', name)
    }

    get disabled() {
        return this.hasAttribute('disabled')
    }

    set disabled(disabled: boolean) {
        this.toggleAttribute('disabled', disabled)
    }

    get status(): Status | null {
        return this.#field?.status ?? null
    }

    get target(): TargetInput | undefined {
        return this.#extra.target ?? ((this.getAttribute('target') as TargetName | null) || undefined)
    }

    /** A target name, a profile, or an adapter's target such as `croner(Cron)`. */
    set target(target: TargetInput | undefined) {
        this.#update({ target })
    }

    set describe(describe: CronFieldOptions['describe']) {
        this.#update({ describe })
    }

    /** Translates every string the field shows; see `Translate`. Named apart from HTMLElement's own `translate`. */
    set translateMessage(translate: CronFieldOptions['translate']) {
        this.#update({ translate })
    }

    set parts(parts: CronFieldOptions['parts']) {
        this.#update({ parts })
    }

    set presets(presets: CronFieldOptions['presets']) {
        this.#update({ presets })
    }

    get form() {
        return this.#internals.form
    }

    get validity() {
        return this.#internals.validity
    }

    get validationMessage() {
        return this.#internals.validationMessage
    }

    checkValidity() {
        return this.#internals.checkValidity()
    }

    reportValidity() {
        return this.#internals.reportValidity()
    }

    focus(options?: FocusOptions) {
        if (this.#field) {
            this.#field.focus()
        } else {
            super.focus(options)
        }
    }

    connectedCallback() {
        // Defined by a script that runs before the page is parsed, the element connects before its children, the fallback input
        // among them. It waits for them; until then the fallback input is the field.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.isConnected && !this.#field && this.connectedCallback(), { once: true })

            return
        }

        const fallback = this.querySelector('input')

        // The attribute and the fallback input seed the first connection only, unless a value was set before it; a moved
        // element keeps its edits.
        if (!this.#started) {
            this.#started = true
            this.#default = this.getAttribute('value') ?? fallback?.value ?? ''
            this.#value = this.#assigned ? this.#value : this.#default

            if (fallback?.name && !this.hasAttribute('name')) {
                this.setAttribute('name', fallback.name)
            }
        }

        this.#field = createCronField(this, { ...this.#options(), value: this.#value, onChange: (value, detail) => this.#changed(value, detail) })
        this.#modes.observe(this, { attributes: true, attributeFilter: ['data-raw'] })
        this.#sync()
    }

    disconnectedCallback() {
        this.#modes.disconnect()
        this.#value = this.value
        this.#field?.destroy()
        this.#field = null
    }

    attributeChangedCallback(name: (typeof ATTRIBUTES)[number], _old: string | null, next: string | null) {
        if (name === 'value') {
            this.value = next ?? ''
        } else {
            this.#update()
        }
    }

    formResetCallback() {
        this.value = this.#default
    }

    /** Back navigation and autofill bring the submitted value back. */
    formStateRestoreCallback(state: string | File | FormData | null) {
        if (typeof state === 'string') {
            this.value = state
        }
    }

    formDisabledCallback() {
        this.#update()
    }

    /** Applies option changes and refreshes the form's view of validity, which can change with the target. */
    #update(extra: Extra = {}) {
        this.#extra = { ...this.#extra, ...extra }
        this.#field?.setOptions(this.#options())
        this.#sync()
    }

    #options(): CronFieldOptions {
        const get = (name: string) => this.getAttribute(name) ?? undefined
        const label = get('label')
        const hourCycle = get('hourcycle') as HourCycle | undefined
        const weekStart = Number(get('weekstart') ?? NaN)

        return {
            ...this.#extra,
            target: this.target,
            label,
            labelledBy: label ? undefined : (get('labelledby') ?? this.#labelId()),
            timezone: get('timezone'),
            hourCycle: hourCycle && HOUR_CYCLES.includes(hourCycle) ? hourCycle : undefined,
            locale: get('locale'),
            weekStart: weekStart >= 0 && weekStart <= 6 ? weekStart : undefined,
            chipWidth: get('chipwidth') === 'equal' ? 'equal' : undefined,
            defaultMode: get('defaultmode') === 'cron' ? 'cron' : undefined,
            // Form-associated elements match :disabled for their own attribute and for a disabled fieldset.
            disabled: this.matches(':disabled'),
        }
    }

    /** A <label for> pointing at the element names the chips too. */
    #labelId() {
        const label = this.#internals.labels[0] as HTMLElement | undefined

        if (label && !label.id) {
            label.id = `${this.id || 'cron-field'}-label-${Math.random().toString(36).slice(2, 8)}`
        }

        return label?.id
    }

    #changed(value: string, detail: ChangeDetail) {
        this.#value = value
        this.#sync()
        this.dispatchEvent(new Event('input', { bubbles: true }))
        this.dispatchEvent(new CustomEvent<ChangeDetail>('change', { bubbles: true, detail }))
    }

    #sync() {
        const status = this.#field?.status
        const message = status && !status.valid ? (status.message?.text ?? translator(this.#extra.translate)('ui.invalid')) : ''
        // Validity points at what shows: the text input in Edit as cron, else the first chip.
        const anchor =
            this.querySelector<HTMLElement>('[data-part="input"]:not([hidden])') ?? this.querySelector<HTMLElement>('[data-part="chip"]') ?? undefined

        this.#internals.setFormValue(this.value)
        this.#internals.setValidity(message ? { customError: true } : {}, message, anchor)
    }
}

/**
 * Registers the element, once, under `tag`. Each tag gets its own subclass, since the registry takes a class only
 * once: two tags, or two copies of the package on one page, can each define one.
 */
export const defineCronField = (tag = 'cron-field') => {
    if (!customElements.get(tag)) {
        customElements.define(tag, class extends CronFieldElement {})
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'cron-field': CronFieldElement
    }
}
