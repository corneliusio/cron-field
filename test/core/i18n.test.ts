/*
 * Bring-your-own translation: the built-in ICU formatter, the translate contract, and every string from the
 * parser, messages and menus going through it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    compile,
    formatMessage,
    menu,
    MESSAGES,
    messageFor,
    resolveTarget,
    status,
    TARGETS,
    translator,
    type MessageRequest,
    type Translate,
} from '../../src/index.ts'

test('formats ICU arguments, plurals and selects', () => {
    assert.equal(formatMessage('Hi {name}', { name: 'Ada' }), 'Hi Ada')
    assert.equal(formatMessage('{n, plural, =0 {none} one {# run} other {# runs}}', { n: 0 }), 'none')
    assert.equal(formatMessage('{n, plural, =0 {none} one {# run} other {# runs}}', { n: 1 }), '1 run')
    assert.equal(formatMessage('{n, plural, =0 {none} one {# run} other {# runs}}', { n: 1200 }), '1,200 runs')
    assert.equal(formatMessage('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}', { n: 22 }), '22nd')
    assert.equal(formatMessage('{f, select, a {{n, plural, one {one A} other {# As}}} other {B}}', { f: 'a', n: 2 }), '2 As')
    assert.equal(formatMessage('{f, select, a {A} other {B}}', { f: 'z' }), 'B')
})

test('reads apostrophes as ICU does', () => {
    assert.equal(formatMessage("it's {x}", { x: 'fine' }), "it's fine")
    assert.equal(formatMessage("'{literal}' and ''", {}), "{literal} and '")
    assert.equal(formatMessage("{n, plural, other {'#' is #}}", { n: 4 }), '# is 4')
})

test('keeps # to the nearest plural and select keys to their own options', () => {
    assert.equal(formatMessage('{n, plural, other {{s, select, other {# files}}}}', { n: 3, s: 'any' }), '# files')
    assert.equal(formatMessage('{s, select, other {fallback}}', { s: 'constructor' }), 'fallback')
    assert.equal(formatMessage('{s, select, other {fallback}}', { s: '__proto__' }), 'fallback')
})

test('rejects templates it cannot read', () => {
    assert.throws(() => formatMessage('{n, number}', { n: 1 }), SyntaxError)
    assert.throws(() => formatMessage('{f, select, a {A}}', { f: 'a' }), SyntaxError)
    assert.throws(() => formatMessage('unclosed {x', { x: 1 }), SyntaxError)
})

test('every catalog template parses', () => {
    for (const [id, template] of Object.entries(MESSAGES)) {
        assert.doesNotThrow(() => formatMessage(template, {}), id)
    }
})

test('translate receives the id, the English template and value params', () => {
    const seen: MessageRequest[] = []
    const t = translator(message => {
        seen.push(message)

        return message.id
    })

    t('error.empty', { field: 'weekday' })

    const request = seen.find(message => message.id === 'error.empty')

    assert.equal(request?.template, MESSAGES['error.empty'])
    assert.deepEqual(request?.params, { field: 'weekday' })
})

test('parser errors, messages and menus all go through translate', () => {
    // A pseudo-locale: every message bracketed, so anything untranslated would show bare.
    const pseudo: Translate = ({ template, params }) => `[${formatMessage(template, params)}]`
    const t = translator(pseudo)
    const vercel = TARGETS.vercel
    const github = resolveTarget('github')

    assert.equal(messageFor(compile('0 9 * * MON', vercel), t)?.text, '[[Day of week]: [Vercel doesn’t read names. Use numbers.]]')
    assert.equal(messageFor(compile('0 9 * * MON', vercel), t)?.fix?.label, '[Use 1]')
    assert.equal(messageFor(compile('0 9 *', vercel), t)?.text, '[Vercel needs 5 fields. This has 3.]')
    assert.equal(
        status('*/2 * * * *', compile('*/2 * * * *', github.profile), github, { translate: pseudo }).message?.text,
        '[GitHub Actions runs a schedule at most every 5 minutes.]',
    )
    assert.equal(status('0 0 31 2 *', compile('0 0 31 2 *', github.profile), github, { translate: pseudo }).message?.text, '[February never has a [31st].]')
    assert.deepEqual(
        menu('minute', compile('*/15 9 * * *', TARGETS.croner), { translate: pseudo }).sections[0]?.presets.map(([label]) => label),
        // Presets take the chip's words, so each label is built from messages too.
        [
            '[Every minute]',
            '[every 5 minutes]',
            '[every 10 minutes]',
            '[every 15 minutes]',
            '[every 30 minutes]',
            '[at [:00]]',
            '[[every 15 minutes], starting [:05]]',
            '[[every 15 minutes], starting [:10]]',
        ],
    )
})
