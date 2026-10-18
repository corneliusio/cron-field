<!--
    The field for Svelte 5, with a bindable value. Before hydration, and without JavaScript, a plain input
    holds the value, so the form still submits it.

        <CronField bind:value name="schedule" target={croner(Cron)} />
-->
<script lang="ts">
    import { onMount } from 'svelte'
    import { createCronField, translator, type ChangeDetail, type CronFieldInstance, type CronFieldOptions } from '../index.js'

    type Props = Omit<CronFieldOptions, 'value' | 'onChange'> & {
        value?: string
        onchange?: (value: string, detail: ChangeDetail) => void
        class?: string
        field?: CronFieldInstance | null
    }

    let {
        value = $bindable(''),
        field = $bindable(null),
        onchange,
        class: className = '',
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
    }: Props = $props()

    let element: HTMLDivElement

    const options = (): CronFieldOptions => ({
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
    })

    onMount(() => {
        field = createCronField(element, {
            ...options(),
            value,
            onChange: (next, detail) => {
                value = next
                onchange?.(next, detail)
            },
        })

        return () => {
            field?.destroy()
            field = null
        }
    })

    $effect(() => {
        field?.setValue(value)
    })

    $effect(() => {
        field?.setOptions(options())
    })
</script>

{#if !field}
    <div class="cron-field {className}" data-part="root">
        <input
            data-part="input"
            type="text"
            {name}
            {value}
            {disabled}
            aria-label={label ?? translator(translate)('ui.schedule')}
            spellcheck="false"
            autocomplete="off" />
    </div>
{/if}
<div bind:this={element} class="cron-field {className}" hidden={!field}></div>
