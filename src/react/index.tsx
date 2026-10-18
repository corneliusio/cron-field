/*
 * The field for React. It mounts the vanilla field into a div React leaves alone. Before hydration,
 * and without JavaScript, a plain input holds the value, so the form still submits it.
 *
 *     <CronField name="schedule" value={value} onChange={setValue} target={croner(Cron)} />
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { createCronField, type ChangeDetail, type CronFieldInstance, type CronFieldOptions } from '../dom/create.ts'
import { translator } from '../i18n/translate.ts'

export type CronFieldProps = Omit<CronFieldOptions, 'value' | 'onChange'> & {
    /** Controlled: a change the parent doesn't take is put back. Use `defaultValue` to leave the field in charge. */
    value?: string | undefined
    defaultValue?: string | undefined
    onChange?: ((value: string, detail: ChangeDetail) => void) | undefined
    className?: string | undefined
    style?: CSSProperties | undefined
    id?: string | undefined
    ref?: Ref<CronFieldInstance | null> | undefined
}

const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

export const CronField = ({
    value,
    defaultValue,
    onChange,
    className,
    style,
    id,
    ref,
    target,
    label,
    labelledBy,
    name,
    disabled,
    timezone,
    hourCycle,
    locale,
    weekStart,
    describe,
    parts,
    presets,
    chipWidth,
    translate,
}: CronFieldProps) => {
    const element = useRef<HTMLDivElement>(null)
    const field = useRef<CronFieldInstance | null>(null)
    const changed = useRef(onChange)
    const controlled = useRef(value)
    const [mounted, setMounted] = useState(false)
    const classes = ['cron-field', className].filter(Boolean).join(' ')
    const options: CronFieldOptions = {
        target,
        label,
        labelledBy,
        name,
        disabled,
        timezone,
        hourCycle,
        locale,
        weekStart,
        describe,
        parts,
        presets,
        chipWidth,
        translate,
    }

    useImperativeHandle<CronFieldInstance | null, CronFieldInstance | null>(ref, () => field.current, [mounted])

    useIsomorphicLayoutEffect(() => {
        changed.current = onChange
        controlled.current = value
    })

    useIsomorphicLayoutEffect(() => {
        if (!element.current) {
            return
        }

        field.current = createCronField(element.current, {
            ...options,
            value: value ?? defaultValue ?? '',
            onChange: (next, detail) => {
                changed.current?.(next, detail)
                // After the parent has had its render: if it kept a different value, the field goes back to it.
                setTimeout(() => {
                    if (controlled.current !== undefined && field.current && field.current.value !== controlled.current) {
                        field.current.setValue(controlled.current)
                    }
                })
            },
        })
        setMounted(true)

        return () => {
            field.current?.destroy()
            field.current = null
        }
        // Created once; later props go through setValue and setOptions.
    }, [])

    useIsomorphicLayoutEffect(() => {
        if (value !== undefined) {
            field.current?.setValue(value)
        }
    }, [value])

    useIsomorphicLayoutEffect(() => {
        field.current?.setOptions(options)
    }, [target, label, labelledBy, name, disabled, timezone, hourCycle, locale, weekStart, describe, parts, presets, chipWidth, translate])

    return (
        <>
            {!mounted && (
                <div className={classes} style={style} data-part="root">
                    <input
                        data-part="input"
                        type="text"
                        name={name}
                        defaultValue={value ?? defaultValue ?? ''}
                        aria-label={label ?? translator(translate)('ui.schedule')}
                        spellCheck={false}
                        autoComplete="off"
                        disabled={disabled}
                    />
                </div>
            )}
            <div ref={element} id={id} className={classes} style={style} hidden={!mounted} />
        </>
    )
}

export type { ChangeDetail, CronFieldInstance, CronFieldOptions }
