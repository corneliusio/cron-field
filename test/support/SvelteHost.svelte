<!--
    A parent with its own state for Svelte tests: a bindable prop only updates both ways from a runes parent.
    `bind: false` passes the value one way.
-->
<script lang="ts">
    import { CronField, type CronFieldInstance, type CronFieldProps } from '../../src/svelte/index.js'

    type Options = Omit<CronFieldProps, 'value' | 'field'>

    let { value: initial = '', bind = true, ...rest }: Options & { value?: string; bind?: boolean } = $props()
    // svelte-ignore state_referenced_locally
    let value = $state(initial)
    // svelte-ignore state_referenced_locally
    let options = $state.raw<Options>(rest)
    let field = $state.raw<CronFieldInstance | null>(null)

    export const get = () => value
    export const set = (next: string) => (value = next)
    /** Replaces every option, so one left out is removed. */
    export const update = (next: Options) => (options = next)
    export const instance = () => field
</script>

{#if bind}
    <CronField bind:value bind:field {...options} />
{:else}
    <CronField {value} bind:field {...options} />
{/if}
