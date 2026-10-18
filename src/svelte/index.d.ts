import type { Component } from 'svelte'
import type { ChangeDetail, CronFieldInstance, CronFieldOptions } from '../index.js'

export type CronFieldProps = Omit<CronFieldOptions, 'value' | 'onChange'> & {
    value?: string
    onchange?: (value: string, detail: ChangeDetail) => void
    class?: string
    field?: CronFieldInstance | null
}

export declare const CronField: Component<CronFieldProps, {}, 'value' | 'field'>
export type { ChangeDetail, CronFieldInstance, CronFieldOptions }
