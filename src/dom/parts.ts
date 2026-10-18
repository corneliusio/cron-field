/*
 * Parts: every element the field renders carries `data-part`, plus state attributes, so CSS can style
 * it by selector. The `parts` option adds classes and inline styles per part for systems that can't
 * target descendants, such as StyleX (`stylex.props()` returns exactly `{ className, style }`).
 */
import type { FieldKey } from '../core/fields.ts'

export type PartName =
    | 'root'
    | 'head'
    | 'label'
    | 'mode-toggle'
    | 'box'
    | 'chips'
    | 'chip'
    | 'token'
    | 'chip-label'
    | 'input'
    | 'menu'
    | 'section'
    | 'section-head'
    | 'dot'
    | 'section-title'
    | 'clear'
    | 'presets'
    | 'preset'
    | 'check'
    | 'custom'
    | 'custom-input'
    | 'custom-hint'
    | 'nth'
    | 'select'
    | 'days'
    | 'day-toggle'
    | 'note'
    | 'message'
    | 'fix'

export type PartState = {
    field?: FieldKey
    /** The chip's menu is open, or the field is in Edit as cron. */
    open: boolean
    invalid: boolean
    /** A preset in effect, or a pressed day. */
    selected: boolean
    /** The chip's field is `*`. */
    any: boolean
    /** The chip, or a section's dot, belongs to the section under the pointer or focus. */
    target: boolean
    disabled: boolean
}

export type PartProps = { className?: string | undefined; style?: Readonly<Record<string, string | number | null | undefined>> | undefined }
export type Parts = Partial<Record<PartName, PartProps | ((state: PartState) => PartProps)>>

const applied = new WeakMap<HTMLElement, { classes: string[]; styles: string[] }>()

const kebab = (name: string) => (name.startsWith('--') ? name : name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`))

const NO_STATE: PartState = { open: false, invalid: false, selected: false, any: false, target: false, disabled: false }

/** Marks an element as a part and applies the `parts` option for it, replacing what an earlier call applied. */
export const part = (element: HTMLElement, name: PartName, parts: Parts | undefined, state: Partial<PartState> = {}) => {
    const entry = parts?.[name]
    const props = typeof entry === 'function' ? entry({ ...NO_STATE, ...state }) : entry
    const previous = applied.get(element) ?? { classes: [], styles: [] }
    const classes = props?.className?.split(/\s+/).filter(Boolean) ?? []
    const styles = Object.entries(props?.style ?? {}).filter(([, value]) => value !== null && value !== undefined)

    // Renders mark every element again; writing only what differs saves style recalculation.
    if (element.dataset.part !== name) {
        element.dataset.part = name
    }

    if (previous.classes.join(' ') !== classes.join(' ')) {
        element.classList.remove(...previous.classes)
        element.classList.add(...classes)
    }

    previous.styles.forEach(prop => element.style.removeProperty(prop))
    styles.forEach(([prop, value]) => element.style.setProperty(kebab(prop), String(value)))
    applied.set(element, { classes, styles: styles.map(([prop]) => kebab(prop)) })
}
