/*
 * A happy-dom window on globalThis for one test file, plus the popover API happy-dom lacks, and helpers for driving
 * the field. Import it before anything that touches the DOM. Each test file runs in its own process, so the globals
 * never reach core tests.
 */
import assert from 'node:assert/strict'
import { after } from 'node:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { FieldKey } from '../../src/index.ts'

GlobalRegistrator.register({ url: 'http://localhost/' })
// Emptying the page first lets elements still in it disconnect while the globals exist. Closing the window also
// stops Vue's dev-build devtools timer, which would hold the process for 3 s.
after(async () => {
    document.body.replaceChildren()
    await GlobalRegistrator.unregister()
})

// Popovers only open and close here; there is no top layer to test.
const open = new WeakSet<Element>()
const matches = Element.prototype.matches

HTMLElement.prototype.showPopover = function () {
    open.add(this)
}
HTMLElement.prototype.hidePopover = function () {
    open.delete(this)
}
Element.prototype.matches = function (this: Element, selectors: string) {
    return selectors === ':popover-open' ? open.has(this) : matches.call(this, selectors)
} as Element['matches']

const describeNode = (node: unknown) =>
    node instanceof Element
        ? `<${[node.localName, ...[...node.attributes].filter(({ name }) => name === 'id' || name.startsWith('data-')).map(({ name, value }) => `${name}="${value}"`)].join(' ')}>`
        : String(node)

/** Lets timers queued by the field run: the reset put-back, and the wrappers' controlled put-back. */
export const tick = () => new Promise(resolve => setTimeout(resolve))
export const key = (element: Element, name: string) => element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
/** A click from a mouse; `element.click()` is the one a key press sends, with no pointer type and detail 0. */
export const mouseClick = (element: Element) => element.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'mouse', detail: 1 }))
/** The chips' tokens joined, which reads as the value they show. */
export const tokens = (root: ParentNode) => [...root.querySelectorAll('[data-part="token"]')].map(token => token.textContent).join(' ')
/** Asserts two nodes are one and the same. `assert.equal` would inspect the whole window to report a failure. */
export const sameNode = (actual: Node | null | undefined, expected: Node | null | undefined, message = 'not the expected node') =>
    assert.ok(actual === expected, `${message}: got ${describeNode(actual)}, expected ${describeNode(expected)}`)
export const find = <E extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => {
    const element = root.querySelector<E>(selector)

    assert.ok(element, `${selector} is missing`)

    return element
}
export const chip = (root: ParentNode, field: FieldKey) => find<HTMLButtonElement>(root, `[data-part="chip"][data-field="${field}"]`)
/** Replaces an input's text, as typing does, and fires its input event. */
export const typeInto = (input: HTMLInputElement, text: string) => {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Records the listeners added to the document and window from now on; `attached()` lists the types of those still there. */
export const trackListeners = () => {
    const live = new Map<unknown, string>()
    const undo = [document, globalThis].map((target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>) => {
        const { addEventListener: add, removeEventListener: remove } = target

        target.addEventListener = (type, listener, options) => {
            live.set(listener, type)
            add.call(target, type, listener, options)
        }
        target.removeEventListener = (type, listener, options) => {
            live.delete(listener)
            remove.call(target, type, listener, options)
        }

        return () => Object.assign(target, { addEventListener: add, removeEventListener: remove })
    })

    return {
        attached: () => [...live.values()].sort(),
        stop: () => undo.forEach(restore => restore()),
    }
}
