# cron-field

A cron schedule field. Each cron field is a chip; its menu offers presets for that field, and Edit as cron swaps the chips for one text input. The field
parses, writes and describes schedules in the syntax of the target that will run them.

Not published yet. `prototype/`, `concepts/` and `review/` hold the earlier explorations.

## Use

```ts
import { createCronField } from 'cron-field'
import 'cron-field/theme.css'

const field = createCronField(document.querySelector('#schedule'), {
    value: '0 9 * * 1-5',
    target: 'github',
    name: 'schedule',
    onChange: (value, { valid, description }) => console.log(value, valid, description),
})
```

`setValue` and `setOptions` update a field; passing `undefined` for an option clears it back to its default.

Wrappers mount the same field and render a plain input until it does, so forms submit without JavaScript:

| Entry                    | Use                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ |
| `cron-field`             | `createCronField`, plus the parser, describer, matcher and menu model          |
| `cron-field/element`     | `defineCronField()` registers `<cron-field>`, a form-associated custom element |
| `cron-field/react`       | `<CronField value onChange />`                                                 |
| `cron-field/svelte`      | `<CronField bind:value />`                                                     |
| `cron-field/vue`         | `<CronField v-model />`                                                        |
| `cron-field/croner`      | `croner(Cron, options)`                                                        |
| `cron-field/effect`      | `effect(Cron, options)`                                                        |
| `cron-field/cron-parser` | `cronParser(CronExpressionParser, options)`                                    |

A controlled `value` in React or `v-model` in Vue wins: a change the parent doesn't take is put back. Removing a prop clears that option.

## Targets

`target` takes a name or an adapter's target. Names cover targets with nothing to inject: `vixie` (the default), `croner`, `cron-parser`, `effect`,
`vercel`, `cloudflare`, `github`, `quartz`, `eventbridge`. A target decides the fields (Quartz adds seconds, EventBridge a year), weekday numbering,
names, `?`, steps, extensions such as `L`, `W` and `#`, and how the two day fields combine.

Adapters receive the library, so the package never depends on a version of it, and build the profile from the same options the job uses:

```ts
import { croner } from 'cron-field/croner'
import { Cron } from 'croner'

createCronField(element, { target: croner(Cron, { domAndDow: true, timezone: 'America/Chicago' }) })
```

With an adapter, validation and "never runs" checks come from the library. `describe` replaces the sentence under the field, for another language or
another describer.

`hourCycle` sets how times read in chip labels, hour presets and the sentence: `h12` (the default, "9:00 AM"), `h11`, `h23` ("09:00") or `h24`, as
in `Intl`. On `<cron-field>` it is the `hourcycle` attribute.

## Presets

Each chip's menu offers presets for its field. `presets` replaces them per field, or extends them with a function that receives the defaults:

```ts
createCronField(element, {
    presets: {
        hour: ['*', '8-18', '12'],
        weekday: defaults => [...defaults, '1,3,5'],
    },
})
```

A preset is a token in the target's syntax; tokens the target can't read are left out. Its label is the chip's own words for that token, so a
preset reads the same as the chip after you pick it, and needs no message of its own. Day-of-week tokens with `#` or `L` go into the Days menu's
occurrence section. On `<cron-field>`, `presets` is a property.

## Translation

Every string the field shows goes through `translate`, one synchronous function that gets a stable id, the English ICU MessageFormat template and the
params. Any i18n library can answer it:

```ts
createCronField(element, {
    locale: 'de',
    translate: ({ id, template, params }) => intl.formatMessage({ id, defaultMessage: template }, params),
})
```

- **`locale`** formats times, month and weekday names and lists with `Intl`, and sets the defaults for `hourCycle` and `weekStart` (the first day of the
  week in the Days menu). Without it the field reads English with a 12-hour clock and a Monday-first week. Ordinals and the `:05` minute mark are
  catalog messages, since `Intl` can't spell them.
- **The sentence and chip labels** are built from clause messages: the time of day, the days, years and the timezone, joined by `sentence.*` messages a
  translation can reorder. Chip labels are written lowercase and capitalized once finished, so a label reads the same alone or after another.
- **Params** are values, not English words: field keys such as `minute` (for `select`), numbers, cron tokens, target names, and values `Intl` has
  formatted. Where grammar could need another form, the raw value comes too, such as `day` (0–6) beside `dayName`.
- **`cron-field/messages.json`** has every id with its English and its params, in FormatJS's extracted format, for translation tools. `MESSAGES` is the
  same catalog in code.

Without `translate`, a small built-in formatter renders the English. On `<cron-field>` the option is the `translateMessage` property, since
`translate` is a native HTMLElement property; `locale` and `weekstart` are attributes. Keep the function's identity stable across renders in React,
Svelte and Vue.

## Styling

Three levels, one import each. The field works at all of them.

| Import                 | Gives                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| nothing                | Browser-default controls; menus and labels are popovers the browser hides |
| `cron-field/base.css`  | Layout only, at zero specificity                                          |
| `cron-field/theme.css` | The default look; includes base                                           |

Every element has `data-part` and state attributes (`data-field`, `data-any`, `data-invalid`, `data-target`, `aria-expanded`, `aria-current`,
`aria-pressed`). Theme rules are element-level, so any single class overrides them. The `parts` option adds a class and inline style per part, as a
function of its state where needed:

```ts
// StyleX
parts: {
    chip: state => stylex.props(styles.chip, state.open && styles.open)
}

// Tailwind
parts: {
    chip: {
        className: 'rounded-full'
    }
}
```

With Tailwind v4, import the theme below utilities: `@import 'cron-field/theme.css' layer(components);`.

Sizes follow the field's font size. Light and dark follow the inherited `color-scheme`.

### Tokens

Set them anywhere: on `:root`, a wrapper, or the field. Each falls back to a common theme variable, then to the theme's own values.

| Token                                                                            | Falls back to                         | For                                      |
| -------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| `--cron-field-bg`                                                                | `--background`                        | The box and inputs                       |
| `--cron-field-fg`                                                                | `--foreground`                        | Text                                     |
| `--cron-field-muted`                                                             | `--muted-foreground`                  | Hints, headings, `*` chips               |
| `--cron-field-border`                                                            | `--input`                             | Control borders; chip fills mix it       |
| `--cron-field-divider`                                                           | `--border`                            | Lines between menu sections              |
| `--cron-field-chip`                                                              | border at 56%                         | Chip fill                                |
| `--cron-field-popover`                                                           | `--popover`                           | Menus and chip labels                    |
| `--cron-field-hover`                                                             | `--accent`                            | Hovered rows and pills                   |
| `--cron-field-ring`                                                              | `--ring`                              | Focus                                    |
| `--cron-field-error`                                                             | `--error-foreground`, `--destructive` | Errors                                   |
| `--cron-field-link`                                                              | `--info-foreground`                   | Fix buttons                              |
| `--cron-field-radius`                                                            | `--radius`                            | Corners; chips and rows step in          |
| `--cron-field-shadow`                                                            |                                       | Menus and chip labels                    |
| `--cron-field-font`, `--cron-field-font-mono`                                    | `--font-sans`, `--font-mono`          | Labels, tokens                           |
| `--cron-field-font-size`                                                         | `1em`                                 | Scale of the whole field                 |
| `--cron-field-ink`                                                               | `--cron-field-fg`                     | Chip text for every field                |
| `--cron-field-minute`, `-hour`, `-day`, `-month`, `-weekday`, `-second`, `-year` | `--cron-field-ink`                    | One field's chip text and target outline |

## Experimental: Temporal

`cron-field/experimental/temporal` is the same field and core with Temporal in place of Date wherever the API deals in time. It needs
`globalThis.Temporal`, native or a polyfill loaded first, and may change.

```ts
import { compile, createCronField, nextRuns, TARGETS } from 'cron-field/experimental/temporal'

nextRuns(compile('0 9 * * 1-5', TARGETS.github), { count: 3 }) // Temporal.ZonedDateTime[]
```

- `nextRuns` and `upcoming` take `from` as a `Temporal.Instant` or `ZonedDateTime` and return `ZonedDateTime`s in the schedule's zone.
- The field, the sentence and the chip labels work as in `cron-field`; times and names are spelled through Temporal.
- Parser libraries still work in Date, so wrap their targets: `fromDateTarget(croner(Cron))`. That is the one place the entry touches Date.
- Known gap: Node 26 drops the zero-padding of Japanese 24-hour times through Temporal (7:05, where `cron-field` gives 07:05).

`demo/temporal.html` runs it against `dist/`.

## Develop

```sh
pnpm test     # node --test, against croner, Effect and cron-parser
pnpm check    # tsc and svelte-check
pnpm lint
pnpm build    # dist/
```

`demo/index.html?css=theme|base|none` and `demo/element.html` run against `dist/` from any static server at the repository root.
