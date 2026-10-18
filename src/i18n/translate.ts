/*
 * Bring your own translation. Every string goes through one synchronous function with a stable id, the
 * English ICU template and the params, so any i18n library can answer it:
 *
 *     translate: ({ id, template, params }) => intl.formatMessage({ id, defaultMessage: template }, params)
 *     translate: ({ id, template, params }) => i18next.t(id, { defaultValue: template, ...params })
 *
 * Without one, the built-in formatter renders the English.
 */
import { MESSAGES, type MessageId } from './catalog.ts'
import { formatMessage } from './format.ts'

export type MessageParams = Readonly<Record<string, string | number>>
export type MessageRequest = { id: MessageId; template: string; params: MessageParams }
export type Translate = (message: MessageRequest) => string
/** Renders one message by id, through `translate`. */
export type Translator = (id: MessageId, params?: MessageParams) => string

export const defaultTranslate: Translate = ({ template, params }) => formatMessage(template, params)

export const translator =
    (translate: Translate = defaultTranslate): Translator =>
    (id, params = {}) =>
        translate({ id, template: MESSAGES[id], params })

/** The English, for callers that don't pass a translator. */
export const english = translator()
