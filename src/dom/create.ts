/*
 * The field in plain DOM. Each cron field is a chip in an input-sized box; a chip's menu offers presets
 * for its field and sits right after it, so Tab goes chip, its menu, next chip. Menus and chip labels are
 * popovers in the top layer, so a host's clipping can't cut them off, and the browser hides them without
 * any CSS. Edit as cron swaps the chips for one text input.
 */
import { dateEngine, type Engine } from '../core/engine.ts'
import type { FieldKey } from '../core/fields.ts'
import { parseField, sample, tokenize, compile, type Compiled } from '../core/syntax.ts'
import { resolveAny, type Target, type TargetBase } from '../core/target.ts'
import type { TargetName, TargetProfile } from '../core/targets.ts'
import { formatter, type HourCycle } from '../i18n/locale.ts'
import type { Translate } from '../i18n/translate.ts'
import {
    applyChanges,
    daysNote,
    dowSet,
    isCurrent,
    menu as menuFor,
    menuOf,
    nthItem,
    nthOptions,
    nthToken,
    sectionFilled,
    toggleDay,
    type Changes,
    type Menu,
    type Presets,
} from '../model/menus.ts'
import { issueText, status as statusOf, type Describe, type Message, type Status } from '../model/messages.ts'
import { chipWords } from '../model/words.ts'
import { part, type PartName, type Parts, type PartState } from './parts.ts'

export type ChangeDetail = Status & { value: string }

/** Every option takes `undefined`, which in `setOptions` clears it back to the default. `T` is the entry's target type. */
export type CronFieldOptionsOf<T> = {
    value?: string | undefined
    target?: TargetName | TargetProfile | T | undefined
    /** The visible label. Ignored when `labelledBy` points at the host's own label. */
    label?: string | undefined
    labelledBy?: string | undefined
    /** Submits the value with a form, through a hidden input. */
    name?: string | undefined
    disabled?: boolean | undefined
    /** The zone runs are checked and described in. Defaults to the target's, else local time. */
    timezone?: string | undefined
    /** How times read in labels, presets and the sentence: h12 (default) and h11 with AM/PM, h23 and h24 as 24-hour clocks. */
    hourCycle?: HourCycle | undefined
    /** Translates every string the field shows; see `Translate`. Keep its identity stable across renders. */
    translate?: Translate | undefined
    /** A BCP 47 tag such as `de` or `en-GB`, for times, month and weekday names, lists, and the hour cycle and week start defaults. */
    locale?: string | undefined
    /** The first day of the week in the Days menu, 0 (Sunday) to 6. Defaults to the locale's when `locale` is set, else Monday. */
    weekStart?: number | undefined
    describe?: Describe | undefined
    parts?: Parts | undefined
    /** Presets per field, replacing the defaults or, as a function, built from them; see `Presets`. */
    presets?: Presets | undefined
    /** `content` (default): chips share the row by the length of their token. `equal`: every chip gets the same share. */
    chipWidth?: 'content' | 'equal' | undefined
    /** `cron` opens the field in Edit as cron; `chips` (default) opens it on the chips. Read once, when the field is created. */
    defaultMode?: 'chips' | 'cron' | undefined
    onChange?: ((value: string, detail: ChangeDetail) => void) | undefined
}

export type CronFieldOptions = CronFieldOptionsOf<Target>

export type CronFieldInstanceOf<T> = {
    readonly value: string
    readonly status: Status
    setValue(value: string): void
    /** Every option but `value`, which goes through `setValue`. */
    setOptions(options: Partial<Omit<CronFieldOptionsOf<T>, 'value'>>): void
    focus(): void
    destroy(): void
}

export type CronFieldInstance = CronFieldInstanceOf<Target>

type ChipRefs = { chip: HTMLButtonElement; token: HTMLSpanElement; head: HTMLSpanElement; tail: HTMLSpanElement; label: HTMLSpanElement }
type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | null | undefined>

const CHECK =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** Distances in the CSS unit: 4px at a 14px field. Read from the theme so menus follow its scale. */
const GAP = 1
const LABEL_GAP = 1.5
const EDGE = 2
const MIN_MENU = 40

let ids = 0

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag)

    for (const [name, value] of Object.entries(attrs)) {
        if (value !== false && value !== null && value !== undefined) {
            element.setAttribute(name, value === true ? '' : String(value))
        }
    }

    element.append(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false))

    return element
}

/** Whether two `presets` options are the same: lists by content, which wrappers pass anew on each render, and functions by identity. */
const samePresets = (a: Presets | undefined, b: Presets | undefined) =>
    [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].every(key => {
        const x = a?.[key as FieldKey]
        const y = b?.[key as FieldKey]

        return typeof x === 'function' || typeof y === 'function' ? x === y : JSON.stringify(x) === JSON.stringify(y)
    })

/** `aria-invalid` needs the word: a bare attribute reads as false. */
const setInvalid = (element: HTMLElement, invalid: boolean) => {
    if (invalid) {
        element.setAttribute('aria-invalid', 'true')
    } else {
        element.removeAttribute('aria-invalid')
    }
}

const icon = () => {
    const span = h('span', { 'data-part': 'check' })

    span.innerHTML = CHECK

    return span
}

/** Builds the field on an engine. `createCronField` is this on Date; the Temporal entry builds it on Temporal. */
export const createFieldWith = <T extends TargetBase>(engine: Engine, root: HTMLElement, initial: CronFieldOptionsOf<T> = {}): CronFieldInstanceOf<T> => {
    const uid = `cron-field-${++ids}`
    const first = initial.value ?? ''
    const chips = new Map<FieldKey, ChipRefs>()
    const cleanups: (() => void)[] = []
    const opensRaw = initial.defaultMode === 'cron'
    /** Whether the chips can show the value: it has the target's number of fields. */
    const fits = () => tokenize(value, target.profile).length === target.profile.fields.length

    let options: CronFieldOptionsOf<T> = { ...initial }
    let fmt = formatter(options, engine)
    let t = fmt.t
    let target: TargetBase = resolveAny(options.target)
    let value = options.value ?? ''
    let compiled: Compiled = compile(value, target.profile)
    let state: Status = statusOf(value, compiled, target, { ...options, fmt, engine })
    // Edit as cron opened because the chips couldn't show the value, rather than by the user or `defaultMode`.
    let forced = !opensRaw && !fits()
    let raw = opensRaw || forced
    let typing = false
    let before = value
    let openField: FieldKey | null = null
    let typeIn = false
    let targetField: FieldKey | null = null
    let hovered: FieldKey | null = null
    let hushed: FieldKey | null = null
    let dayHovered = false
    let menuEl: HTMLDivElement | null = null
    let stopFloat: (() => void) | null = null
    let chipFields = ''
    let hintShown = ''

    const parts = () => options.parts
    const mark = <E extends HTMLElement>(element: E, name: PartName, extra: Partial<PartState> = {}) => {
        part(element, name, parts(), { disabled: !!options.disabled, ...extra })

        return element
    }
    const unit = () => parseFloat(getComputedStyle(root).getPropertyValue('--_cron-field-u')) || 4

    const labelEl = h('span', { id: `${uid}-label` })
    const toggle = h('button', { type: 'button' })
    const head = h('div', {}, labelEl, toggle)
    const chipsEl = h('div', { 'role': 'group', 'aria-describedby': `${uid}-hint` })
    const box = h('div', {}, chipsEl)
    const input = h('input', { 'type': 'text', 'spellcheck': 'false', 'autocomplete': 'off', 'aria-describedby': `${uid}-hint` })
    const hint = h('p', { 'id': `${uid}-hint`, 'aria-live': 'polite' })
    const hidden = h('input', { type: 'hidden' })

    /* ---------- Values ---------- */

    const recompute = () => {
        compiled = compile(value, target.profile)
        state = statusOf(value, compiled, target, { ...options, fmt, engine })
    }

    const emit = () => options.onChange?.(value, { ...state, value })

    /** Sets the value from inside the field: re-renders, keeps the open menu, and reports the change. */
    const commit = (next: string) => {
        if (next === value) {
            return
        }

        value = next
        recompute()
        render(true)
        emit()
    }

    const apply = (changes: Changes) => {
        if (!options.disabled) {
            commit(applyChanges(value, changes, target.profile))
        }
    }

    /* ---------- Menus ---------- */

    /** Opens a chip's menu; `typed` focuses the menu's text input instead of the preset in effect. */
    const open = (field: FieldKey, typed = false) => {
        if (options.disabled) {
            return
        }

        openField = field
        typeIn = typed
        targetField = null

        render(false)
    }

    const close = (focus?: FieldKey) => {
        openField = null
        targetField = null
        dayHovered = false
        render(false)

        if (focus) {
            chips.get(focus)?.chip.focus()
        }
    }

    /** Focuses the preset in effect for a field, else the first item in the field's last section. */
    const focusPreset = (field: FieldKey) => {
        const sections = [...(menuEl?.querySelectorAll<HTMLElement>(`[data-section-field="${field}"]`) ?? [])]
        const preset = sections.map(section => section.querySelector<HTMLElement>('[aria-current="true"]')).find(Boolean)

        ;(preset ?? sections.at(-1)?.querySelector<HTMLElement>('[data-item]'))?.focus({ preventScroll: true })
    }

    /** Focuses the field's own text input with its value selected, so typing replaces it; else the preset in effect. */
    const focusInput = (field: FieldKey) => {
        const custom = menuEl?.querySelector<HTMLInputElement>(`[data-section-field="${field}"] [data-part="custom-input"]`)

        if (!custom) {
            focusPreset(field)

            return
        }

        custom.focus({ preventScroll: true })
        custom.select()
    }

    /** Keeps the menu under the field, starting at its chip and inside the field; flips it above near the bottom of the window. */
    const float = (menu: HTMLDivElement, field: FieldKey) => {
        const anchor = chips.get(field)?.chip
        const observer = new ResizeObserver(() => place())
        const place = () => {
            if (!anchor) {
                return
            }

            const u = unit()
            const row = box.getBoundingClientRect()
            const chip = anchor.getBoundingClientRect()
            const width = menu.offsetWidth
            const below = innerHeight - row.bottom - (GAP + EDGE) * u
            const above = row.top - (GAP + EDGE) * u
            const flip = menu.scrollHeight > below && above > below
            const left = Math.min(Math.max(chip.left, row.left), row.right - width)

            // The unused side is `auto`, not empty: an empty value drops the inline rule, and the popover's own `inset: 0` comes back.
            Object.assign(menu.style, {
                position: 'fixed',
                inset: 'auto',
                margin: '0',
                left: `${Math.max(EDGE * u, Math.min(left, innerWidth - width - EDGE * u))}px`,
                top: flip ? 'auto' : `${row.bottom + GAP * u}px`,
                bottom: flip ? `${innerHeight - row.top + GAP * u}px` : 'auto',
                maxHeight: `${Math.max(flip ? above : below, MIN_MENU * u)}px`,
            })
        }

        // Only scrolls that move the chip matter: not the menu's own list, nor an unrelated container.
        const scrolled = (event: Event) => {
            if (event.target === document || (event.target instanceof Node && anchor && event.target.contains(anchor))) {
                place()
            }
        }

        menu.showPopover()
        place()
        observer.observe(menu)
        chips.forEach(({ chip }) => observer.observe(chip))
        addEventListener('scroll', scrolled, true)
        addEventListener('resize', place)

        return () => {
            observer.disconnect()
            removeEventListener('scroll', scrolled, true)
            removeEventListener('resize', place)
        }
    }

    const menuKey = (event: KeyboardEvent) => {
        const items = [...(menuEl?.querySelectorAll<HTMLElement>('[data-item]') ?? [])]
        const element = event.target as HTMLElement
        const index = items.indexOf(element)
        const pill = element.dataset.pill !== undefined
        const step = ({ ArrowDown: 1, ArrowUp: -1, ...(pill ? { ArrowRight: 1, ArrowLeft: -1 } : {}) } as Record<string, number>)[event.key]

        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(openField ?? undefined)
        } else if (step && index >= 0) {
            event.preventDefault()
            items[(index + step + items.length) % items.length]?.focus()
        }
    }

    /** Returns true when a menu's text input holds a field the target reads, and shows the error otherwise. */
    const checkCustom = (field: FieldKey, text: string, inputEl: HTMLInputElement, hintEl: HTMLElement) => {
        const issue = parseField(text, field, target.profile).error
        const error = issue ? issueText(issue, t) : ''

        setInvalid(inputEl, !!error)
        hintEl.toggleAttribute('data-invalid', !!error)
        hintEl.textContent = error || t('ui.pressEnter')
        mark(inputEl, 'custom-input', { field, invalid: !!error })
        mark(hintEl, 'custom-hint', { field, invalid: !!error })

        return !error
    }

    /** Clear sets only its own field back to `*`. Its button goes with the value, so focus moves to the preset now in effect. */
    const clear = (field: FieldKey) => {
        apply({ [field]: '*' })
        focusPreset(field)
    }

    const buildSection = (m: Menu, section: Menu['sections'][number], index: number) => {
        const field = section.field
        const pills = m.key === 'days'
        const titleId = `${uid}-section-${index}`
        const dot = pills ? h('i', { 'aria-hidden': 'true' }) : null
        const title = h('span', { id: titleId }, section.title ?? m.title)
        const filled = sectionFilled(section, compiled)
        const clearButton = filled
            ? h('button', { 'type': 'button', 'data-key': `clear:${index}`, 'aria-label': t('ui.clearField', { field }) }, t('ui.clear'))
            : null
        const heading = h('div', {}, h('span', {}, dot, title), clearButton)
        const presets = h('div', { 'data-layout': pills ? 'pills' : 'list' })
        const sectionEl = h('div', { 'role': 'group', 'aria-labelledby': titleId, 'data-section-field': field }, heading, presets)

        section.presets.forEach(([name, token], k) => {
            const current = isCurrent(compiled, field, token)
            const button = h(
                'button',
                { 'type': 'button', 'data-item': true, 'data-pill': pills, 'data-key': `preset:${index}:${k}`, 'aria-current': current ? 'true' : null },
                name,
            )

            if (!pills && current) {
                button.append(icon())
            }

            mark(button, 'preset', { field, selected: current })
            button.addEventListener('click', () => apply({ [field]: token }))
            presets.append(button)
        })

        if (section.control === 'custom') {
            const custom = h('input', {
                'type': 'text',
                'spellcheck': 'false',
                'autocomplete': 'off',
                'data-key': `custom:${field}`,
                'aria-label': t('ui.asCron', { label: t('field.label', { field }) }),
                'aria-describedby': `${uid}-custom-${field}`,
            })
            const note = h('p', { id: `${uid}-custom-${field}` })

            custom.value = compiled.raws[field] ?? ''
            checkCustom(field, custom.value, custom, note)
            custom.addEventListener('input', () => checkCustom(field, custom.value, custom, note))
            custom.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault()

                    if (checkCustom(field, custom.value, custom, note)) {
                        apply({ [field]: custom.value.trim() })
                    }
                }
            })
            sectionEl.append(mark(h('div', {}, custom, note), 'custom', { field }))
        } else if (section.control === 'nth') {
            const nth = nthItem(compiled)
            const which = h(
                'select',
                { 'aria-label': t('section.occurrence'), 'data-key': 'nth:k' },
                h('option', { value: '', disabled: true, hidden: true }, t('ui.which')),
                ...nthOptions(target.profile, t).map(([option, name]) => h('option', { value: option }, name)),
            )
            const day = h(
                'select',
                { 'aria-label': t('field.label', { field: 'weekday' }), 'data-key': 'nth:dow' },
                h('option', { value: '', disabled: true, hidden: true }, t('field.label', { field: 'weekday' })),
                ...fmt.weekOrder.map(d => h('option', { value: String(d) }, fmt.weekday(d))),
            )
            // A select still on its placeholder counts as the first, or Monday.
            const applyNth = () =>
                apply({ weekday: nthToken(which.value || (nthOptions(target.profile)[0]?.[0] ?? '1'), Number(day.value || '1'), target.profile) })

            which.value = nth ? (nth.t === 'nth' ? String(nth.k) : 'L') : ''
            day.value = nth ? String(nth.dow) : ''
            which.addEventListener('change', applyNth)
            day.addEventListener('change', applyNth)
            mark(which, 'select', { field })
            mark(day, 'select', { field })
            sectionEl.append(mark(h('div', {}, which, day), 'nth', { field }))
        } else {
            const on = dowSet(compiled)
            // The section around it is already the Day of week group; a second group of the same name only repeats it.
            const row = h('div', {})

            for (const d of fmt.weekOrder) {
                const pressed = on.has(d)
                const button = h(
                    'button',
                    { 'type': 'button', 'aria-label': fmt.weekday(d), 'aria-pressed': String(pressed), 'data-key': `dow:${d}` },
                    fmt.weekday(d, 'narrow'),
                )

                button.addEventListener('click', () => apply(toggleDay(compiled, d)))
                button.addEventListener('pointerenter', event => {
                    if (event.pointerType !== 'touch') {
                        dayHovered = true
                        paintLabels()
                    }
                })
                button.addEventListener('pointerleave', () => {
                    dayHovered = false
                    paintLabels()
                })
                mark(button, 'day-toggle', { field, selected: pressed })
                row.append(button)
            }

            sectionEl.append(mark(row, 'days', { field }))
        }

        sectionEl.addEventListener('pointerover', () => setTarget(field))
        sectionEl.addEventListener('focusin', () => setTarget(field))
        clearButton?.addEventListener('click', () => clear(field))
        mark(sectionEl, 'section', { field })
        mark(heading, 'section-head', { field })
        mark(title, 'section-title', { field })
        mark(presets, 'presets', { field })

        if (clearButton) {
            mark(clearButton, 'clear', { field })
        }

        if (dot) {
            dot.dataset.field = field
            mark(dot, 'dot', { field, target: targetField === field })
            dot.toggleAttribute('data-active', targetField === field)
        }

        return sectionEl
    }

    /** Builds the open menu's contents, keeping focus on the same control when the value changes under it. */
    const fillMenu = (menu: HTMLDivElement, field: FieldKey) => {
        const m = menuFor(menuOf(field, target.profile), compiled, { fmt, presets: options.presets, year: engine.wall(engine.now()).y })
        const focused = menu.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined
        const note = m.sections.some(section => section.field === 'day' || section.field === 'weekday') ? daysNote(compiled, t) : null
        const noteEl = note ? mark(h('p', {}, note), 'note') : null

        menu.replaceChildren(...m.sections.map((section, i) => buildSection(m, section, i)), ...(noteEl ? [noteEl] : []))
        menu.setAttribute('aria-label', m.title)
        menu.toggleAttribute('data-wide', m.key === 'days')
        mark(menu, 'menu', { open: true, field })

        if (focused) {
            menu.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })
        }
    }

    const renderMenu = (valueChanged: boolean) => {
        const field = openField
        const anchor = field ? chips.get(field)?.chip : null

        if (!field || !anchor || raw) {
            stopFloat?.()
            stopFloat = null
            menuEl?.remove()
            menuEl = null

            return
        }

        // The menu sits right after its chip, so the same anchor means the same menu.
        if (menuEl && menuEl.previousElementSibling === anchor) {
            if (valueChanged) {
                fillMenu(menuEl, field)
            }

            return
        }

        stopFloat?.()
        menuEl?.remove()
        menuEl = h('div', { id: `${uid}-menu`, role: 'dialog', popover: 'manual', tabindex: '-1' })
        menuEl.addEventListener('keydown', menuKey)
        menuEl.addEventListener('pointerleave', () => {
            dayHovered = false
            setTarget(null)
            paintLabels()
        })
        anchor.after(menuEl)
        fillMenu(menuEl, field)
        stopFloat = float(menuEl, field)

        if (typeIn) {
            focusInput(field)
        } else {
            focusPreset(field)
        }
    }

    /* ---------- Chip labels ---------- */

    /** The chip a control in the open menu speaks for: its custom input while focused, or a day toggle under keyboard focus. */
    const menuFocus = (): FieldKey | null => {
        const active = document.activeElement as HTMLElement | null
        const part = active?.dataset.part

        if (!active || !menuEl?.contains(active) || !(part === 'custom-input' || (part === 'day-toggle' && active.matches(':focus-visible')))) {
            return null
        }

        return (active.closest<HTMLElement>('[data-section-field]')?.dataset.sectionField as FieldKey | undefined) ?? null
    }

    /**
     * Shows one label at a time: the chip under a mouse, else the weekday chip while a day toggle is under the mouse, else
     * the chip with keyboard focus or whose menu input has focus, unless Escape hushed it.
     */
    const paintLabels = () => {
        const focused = [...chips].find(([, refs]) => refs.chip.matches(':focus-visible'))?.[0] ?? menuFocus()
        const candidate = hovered ?? (dayHovered ? 'weekday' : null) ?? focused
        const shown = candidate === hushed ? null : candidate

        for (const [key, { chip, label }] of chips) {
            if (key !== shown) {
                if (label.matches(':popover-open')) {
                    label.hidePopover()
                }

                continue
            }

            if (!label.matches(':popover-open')) {
                label.showPopover()
            }

            // Placed on every paint: the label's words change as the menu edits its field.
            placeLabel(chip, label)
        }
    }

    /**
     * Centers the label above its chip, kept inside the field. When the menu has flipped above the field, the label goes
     * below the chip instead, so it never covers the menu.
     */
    const placeLabel = (chip: HTMLElement, label: HTMLElement) => {
        const row = box.getBoundingClientRect()
        const rect = chip.getBoundingClientRect()
        const flipped = !!menuEl?.matches(':popover-open') && menuEl.getBoundingClientRect().bottom <= row.top

        Object.assign(label.style, { position: 'fixed', inset: 'auto', margin: '0', maxWidth: `${row.width}px`, minWidth: `${rect.width}px` })
        label.dataset.side = flipped ? 'bottom' : 'top'

        const width = label.offsetWidth
        const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, row.left), row.right - width)
        const top = flipped ? rect.bottom + LABEL_GAP * unit() : rect.top - label.offsetHeight - LABEL_GAP * unit()

        Object.assign(label.style, { left: `${left}px`, top: `${top}px` })
    }

    /* ---------- Chips ---------- */

    const setTarget = (field: FieldKey | null) => {
        if (field === targetField) {
            return
        }

        targetField = field
        paintChips()
        menuEl?.querySelectorAll<HTMLElement>('[data-part="dot"]').forEach(dot => {
            const field = dot.dataset.field as FieldKey

            dot.toggleAttribute('data-active', field === targetField)
            mark(dot, 'dot', { field, target: field === targetField })
        })
    }

    const chipKey = (event: KeyboardEvent, field: FieldKey) => {
        const fields = target.profile.fields
        const index = fields.indexOf(field)
        const step = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[event.key]

        if (event.key === 'Escape' && openField !== null) {
            event.preventDefault()
            event.stopPropagation()
            close(field)
        } else if (step) {
            event.preventDefault()
            chips.get(fields[Math.min(fields.length - 1, Math.max(0, index + step))] ?? field)?.chip.focus()
        } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            open(field)
        } else if ((event.key === 'Backspace' || event.key === 'Delete') && field !== 'minute' && field !== 'second' && !compiled.parsed[field]?.star) {
            // Seconds and minutes stay: * there means every second or minute, not "no restriction".
            event.preventDefault()
            apply({ [field]: '*' })
        }
    }

    const buildChips = () => {
        const fields = target.profile.fields

        chipFields = fields.join(' ')
        chipsEl.style.setProperty('--n', String(fields.length))
        chips.forEach(({ chip }) => chip.remove())
        chips.clear()

        for (const field of fields) {
            const head = h('span', {})
            const tail = h('span', {})
            const token = h('span', {}, head, tail)
            const label = h('span', { 'id': `${uid}-words-${field}`, 'aria-hidden': 'true', 'popover': 'manual' })
            const chip = h(
                'button',
                { 'type': 'button', 'aria-haspopup': 'dialog', 'aria-describedby': `${uid}-words-${field}`, 'data-field': field },
                token,
                label,
            )

            // Focus stays where it is on press; the menu then takes it.
            chip.addEventListener('mousedown', event => event.preventDefault())
            chip.addEventListener('click', event => {
                // A mouse or pen goes straight to typing a value. A tap keeps the on-screen keyboard closed, and a key press
                // (pointerType '', or detail 0 where click isn't a PointerEvent) keeps arrow keys moving through the presets.
                const { pointerType, detail } = event as MouseEvent & { pointerType?: string }
                const pointer = pointerType ?? (detail ? 'mouse' : '')

                if (openField === field) {
                    close(field)
                } else {
                    open(field, pointer === 'mouse' || pointer === 'pen')
                }
            })
            chip.addEventListener('keydown', event => chipKey(event, field))
            chip.addEventListener('pointerenter', event => {
                if (event.pointerType !== 'touch') {
                    hovered = field
                    paintLabels()
                }
            })
            chip.addEventListener('pointerleave', () => {
                hovered = null
                hushed = null
                paintLabels()
            })
            chip.addEventListener('focus', () => paintLabels())
            chip.addEventListener('blur', () => {
                hushed = null
                paintLabels()
            })
            chipsEl.append(chip)
            chips.set(field, { chip, token, head, tail, label })
        }
    }

    const paintChips = () => {
        const words = chipWords(compiled, { fmt })
        const key = openField ? menuOf(openField, target.profile) : null

        for (const [field, { chip, token, head, tail, label }] of chips) {
            const text = compiled.raws[field] ?? '*'
            // A long list is cut in the middle: the head gives way, the last item stays. The comma ends the head, so the
            // ellipsis takes its place.
            const cut = text.lastIndexOf(',') + 1 || text.length
            const p = compiled.parsed[field]
            const any = !!p?.ok && !words[field]
            const invalid = !p?.ok
            const expanded = key !== null && menuOf(field, target.profile) === key

            head.textContent = text.slice(0, cut)
            tail.textContent = text.slice(cut)
            label.textContent = words[field] ?? t('field.every', { field })
            chip.style.setProperty('--len', String(text.length))
            chip.disabled = !!options.disabled
            chip.toggleAttribute('data-any', any)
            chip.toggleAttribute('data-invalid', invalid)
            chip.toggleAttribute('data-target', targetField === field)
            chip.setAttribute('aria-expanded', String(expanded))
            chip.setAttribute('aria-label', t('ui.chip', { label: t('field.label', { field }), token: text }))

            if (expanded) {
                chip.setAttribute('aria-controls', `${uid}-menu`)
            } else {
                chip.removeAttribute('aria-controls')
            }

            mark(chip, 'chip', { field, open: expanded, invalid, any, target: targetField === field })
            mark(token, 'token', { field })
            mark(head, 'token-head', { field })
            mark(tail, 'token-tail', { field })
            mark(label, 'chip-label', { field })
        }
    }

    /* ---------- Edit as cron ---------- */

    const startRaw = () => {
        before = value
        openField = null
        raw = true
        forced = false
        render(false)
        input.focus()
    }

    /** Done keeps a draft that is the wrong shape open, with its error. Escape puts back the schedule from before editing. */
    const leaveRaw = (cancel: boolean) => {
        // The input keeps what was typed while it has focus, so Escape puts the old value in it too.
        if (cancel) {
            commit(before)
            input.value = before
        }

        if (compiled.structure) {
            input.focus()

            return
        }

        raw = false
        forced = false
        typing = false
        render(false)
        toggle.focus()
    }

    /* ---------- Message ---------- */

    const fix = (message: Message) => {
        if (!message.fix) {
            return
        }

        apply(message.fix.changes)
        ;(raw ? input : chips.get(message.fix.field)?.chip)?.focus()
    }

    /** Rewrites the live region only when its words change, so screen readers don't hear the same message again. */
    const paintHint = () => {
        const message = state.message ?? (state.description ? { text: state.description, bad: false } : null)
        const bad = !!message?.bad
        const shown = `${message?.text ?? ''}\n${message?.fix?.label ?? ''}`

        if (shown === hintShown) {
            return
        }

        hintShown = shown
        hint.replaceChildren(message?.text ?? '')

        if (message?.fix) {
            const button = h('button', { type: 'button' }, message.fix.label)

            button.addEventListener('click', () => fix(message))
            mark(button, 'fix')
            hint.append(' ', button)
        }

        hint.toggleAttribute('data-invalid', bad)
        mark(hint, 'message', { invalid: bad })
    }

    /* ---------- Render ---------- */

    const render = (valueChanged: boolean) => {
        const label = options.labelledBy ? null : (options.label ?? t('ui.schedule'))
        const labelledBy = options.labelledBy ?? `${uid}-label`
        const invalid = !state.valid && !!state.message?.bad

        if (target.profile.fields.join(' ') !== chipFields) {
            buildChips()
        }

        root.classList.add('cron-field')
        root.toggleAttribute('data-invalid', invalid)
        root.toggleAttribute('data-raw', raw)
        root.toggleAttribute('data-disabled', !!options.disabled)
        mark(root, 'root', { invalid, open: raw })

        labelEl.textContent = label ?? ''
        labelEl.hidden = label === null
        toggle.textContent = t(raw ? 'ui.done' : 'ui.editAsCron')
        toggle.disabled = !!options.disabled
        mark(head, 'head')
        mark(labelEl, 'label')
        mark(toggle, 'mode-toggle', { open: raw })

        box.hidden = raw
        box.toggleAttribute('data-invalid', invalid)
        chipsEl.setAttribute('aria-labelledby', labelledBy)
        chipsEl.dataset.chipWidth = options.chipWidth ?? 'content'
        mark(box, 'box', { invalid })
        mark(chipsEl, 'chips')

        input.hidden = !raw
        input.disabled = !!options.disabled
        input.placeholder = sample(target.profile)
        input.setAttribute('aria-labelledby', labelledBy)
        setInvalid(input, invalid)

        if (!typing) {
            input.value = value
        }

        mark(input, 'input', { invalid, open: raw })

        hidden.disabled = !options.name || !!options.disabled
        hidden.name = options.name ?? ''
        hidden.value = value

        // Edit as cron hides the chips; leaving it repaints them.
        if (!raw) {
            paintChips()
        }

        renderMenu(valueChanged)
        paintHint()
        paintLabels()
    }

    /** Edit as cron opens for a value the chips can't show, and closes once they can, unless the user opened it or is typing. */
    const followValue = () => {
        if (!fits()) {
            forced ||= !raw
            raw = true
        } else if (forced && !typing) {
            forced = false
            raw = false
        }
    }

    /** Takes a value from outside: it replaces what Edit as cron shows, and becomes what Escape returns to. */
    const replace = (next: string) => {
        value = next
        recompute()
        input.value = value
        before = value
        followValue()
        render(true)
    }

    /* ---------- Listeners ---------- */

    const listen = <K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void) => {
        document.addEventListener(type, handler)
        cleanups.push(() => document.removeEventListener(type, handler))
    }

    toggle.addEventListener('click', () => (raw ? leaveRaw(false) : startRaw()))
    // While the input has focus it keeps the text as typed, spacing included, rather than the value it parses to.
    input.addEventListener('focus', () => (typing = true))
    input.addEventListener('blur', () => (typing = false))
    input.addEventListener('input', () => commit(input.value.trim().split(/\s+/).join(' ')))
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            leaveRaw(event.key === 'Escape')
        }
    })

    listen('focusin', event => {
        if (openField !== null && !menuEl?.contains(event.target as Node)) {
            close()
        }

        paintLabels()
    })
    // Focus leaving for nowhere, such as a press on the page, sends no focusin; the active element settles after focusout.
    listen('focusout', () => queueMicrotask(paintLabels))
    listen('pointerdown', event => {
        const node = event.target as Node

        if (openField !== null && !box.contains(node) && !menuEl?.contains(node)) {
            close()
        }
    })
    // A reset puts back the field's first value when it submits with the form, else keeps the value it holds, and the mode it
    // opened in. That happens here, before the form resets its controls, so a submit straight after sees it; the form then
    // blanks the text input, which gets the value back once it has.
    listen('reset', event => {
        if (!event.defaultPrevented && event.target instanceof HTMLFormElement && event.target.contains(root)) {
            raw = opensRaw
            forced = false
            replace(options.name ? first : value)
            setTimeout(() => (input.value = value))
        }
    })
    listen('keydown', event => {
        // Escape hides the label under the pointer or focus until the pointer or focus leaves that chip.
        if (event.key === 'Escape' && openField === null) {
            const focused = [...chips].find(([, refs]) => refs.chip === document.activeElement)?.[0] ?? null

            hushed = hovered ?? focused
            paintLabels()
        }
    })

    root.replaceChildren(head, box, input, hint, hidden)
    render(false)

    return {
        get value() {
            return value
        },
        get status() {
            return state
        },
        setValue(next: string) {
            if (next !== value) {
                replace(next)
            }
        },
        setOptions(next: Partial<Omit<CronFieldOptionsOf<T>, 'value'>>) {
            const resolved = resolveAny({ ...options, ...next }.target)
            const sameProfile = JSON.stringify(resolved.profile) === JSON.stringify(target.profile)
            // Wrappers pass every option on each update, and adapters build a new target each call; skip the work when
            // nothing that shows has changed. The new target is still kept, but a library swap with the same profile
            // shows its own validation only from the next value change.
            const changed = (Object.keys(next) as (keyof typeof next)[]).some(key =>
                key === 'target'
                    ? !sameProfile
                    : key === 'presets'
                      ? !samePresets(next.presets, options.presets)
                      : key !== 'onChange' && key !== 'defaultMode' && next[key] !== options[key],
            )

            options = { ...options, ...next }
            target = resolved

            if (!changed) {
                return
            }

            fmt = formatter(options, engine)
            t = fmt.t
            hintShown = ''

            // Only a different profile, or disabling, closes the menu.
            if (!sameProfile || options.disabled) {
                openField = null
            }

            // A value that doesn't fit the new target's fields is edited as cron, as setValue does.
            if (!sameProfile) {
                followValue()
            }

            recompute()
            render(true)
        },
        focus() {
            ;(raw ? input : chips.get(target.profile.fields[0] ?? 'minute')?.chip)?.focus()
        },
        destroy() {
            stopFloat?.()
            cleanups.forEach(cleanup => cleanup())
            root.replaceChildren()
            root.classList.remove('cron-field')

            for (const name of ['data-part', 'data-invalid', 'data-raw', 'data-disabled']) {
                root.removeAttribute(name)
            }
        },
    }
}

export const createCronField = (root: HTMLElement, initial: CronFieldOptions = {}): CronFieldInstance => createFieldWith(dateEngine, root, initial)
