/*
 * The field for Vue 3, with v-model. Before hydration, and without JavaScript, a plain input holds the
 * value, so the form still submits it.
 *
 *     <CronField v-model="schedule" name="schedule" :target="croner(Cron)" />
 */
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type PropType } from 'vue'
import type { TargetInput } from '../core/target.ts'
import { createCronField, type ChangeDetail, type CronFieldInstance, type CronFieldOptions } from '../dom/create.ts'
import { translator } from '../i18n/index.ts'
import type { HourCycle } from '../i18n/locale.ts'

export const CronField = defineComponent({
    name: 'CronField',
    inheritAttrs: false,
    props: {
        modelValue: { type: String, default: undefined },
        target: { type: [String, Object] as PropType<TargetInput>, default: undefined },
        label: { type: String, default: undefined },
        labelledBy: { type: String, default: undefined },
        name: { type: String, default: undefined },
        disabled: { type: Boolean, default: undefined },
        timezone: { type: String, default: undefined },
        hourCycle: { type: String as PropType<HourCycle>, default: undefined },
        locale: { type: String, default: undefined },
        weekStart: { type: Number, default: undefined },
        describe: { type: Function as PropType<CronFieldOptions['describe']>, default: undefined },
        parts: { type: Object as PropType<CronFieldOptions['parts']>, default: undefined },
        presets: { type: Object as PropType<CronFieldOptions['presets']>, default: undefined },
        chipWidth: { type: String as PropType<CronFieldOptions['chipWidth']>, default: undefined },
        translate: { type: Function as PropType<CronFieldOptions['translate']>, default: undefined },
    },
    emits: {
        'update:modelValue': (value: string) => typeof value === 'string',
        'change': (value: string, detail: ChangeDetail) => typeof value === 'string' && !!detail,
    },
    setup(props, { attrs, emit, expose }) {
        const element = ref<HTMLDivElement>()
        const field = shallowRef<CronFieldInstance | null>(null)
        const options = (): CronFieldOptions => ({
            target: props.target,
            label: props.label,
            labelledBy: props.labelledBy,
            name: props.name,
            disabled: props.disabled,
            timezone: props.timezone,
            hourCycle: props.hourCycle,
            locale: props.locale,
            weekStart: props.weekStart,
            describe: props.describe,
            parts: props.parts,
            presets: props.presets,
            chipWidth: props.chipWidth,
            translate: props.translate,
        })

        onMounted(() => {
            if (!element.value) {
                return
            }

            field.value = createCronField(element.value, {
                ...options(),
                value: props.modelValue ?? '',
                onChange: async (value, detail) => {
                    emit('update:modelValue', value)
                    emit('change', value, detail)
                    // After the parent's update: if it kept a different v-model value, the field goes back to it.
                    await nextTick()

                    if (props.modelValue !== undefined && field.value && field.value.value !== props.modelValue) {
                        field.value.setValue(props.modelValue)
                    }
                },
            })
        })

        onBeforeUnmount(() => field.value?.destroy())

        watch(
            () => props.modelValue,
            value => {
                if (value !== undefined) {
                    field.value?.setValue(value)
                }
            },
        )

        watch(
            () => [
                props.target,
                props.label,
                props.labelledBy,
                props.name,
                props.disabled,
                props.timezone,
                props.hourCycle,
                props.locale,
                props.weekStart,
                props.describe,
                props.parts,
                props.presets,
                props.chipWidth,
                props.translate,
            ],
            () => field.value?.setOptions(options()),
        )

        expose({ field })

        return () => [
            field.value
                ? null
                : h('div', { 'class': ['cron-field', attrs.class], 'data-part': 'root' }, [
                      h('input', {
                          'data-part': 'input',
                          'type': 'text',
                          'name': props.name,
                          'value': props.modelValue ?? '',
                          'disabled': props.disabled,
                          'aria-label': props.label ?? translator(props.translate)('ui.schedule'),
                          'spellcheck': 'false',
                          'autocomplete': 'off',
                      }),
                  ]),
            h('div', { ...attrs, ref: element, class: ['cron-field', attrs.class], hidden: !field.value }),
        ]
    },
})

export type { ChangeDetail, CronFieldInstance, CronFieldOptions }
