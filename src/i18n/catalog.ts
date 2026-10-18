/*
 * Every string the field shows, by id, as English ICU MessageFormat. Translators get the id, this template
 * and the params; the field passes them to `translate` and shows what comes back.
 *
 * Params are values, never English words: field keys such as `minute` (for `select`), numbers, cron tokens
 * and target names.
 *
 * Times, month and weekday names and lists come from Intl in the field's locale and arrive as params; where a
 * template could need another grammatical form, the raw value comes along too (`day` as 0–6 next to
 * `dayName`), for `select`.
 */
export const MESSAGES = {
    /* ---------- Fields ---------- */
    'field.label': '{field, select, second {Seconds} minute {Minutes} hour {Hours} day {Day of month} month {Months} weekday {Day of week} other {Years}}',
    'field.every':
        '{field, select, second {Every second} minute {Every minute} hour {Every hour} day {Every day of the month} month {Every month} weekday {Every day of the week} other {Every year}}',

    /* ---------- The field ---------- */
    'ui.schedule': 'Schedule',
    'ui.editAsCron': 'Edit as cron',
    'ui.done': 'Done',
    'ui.chip': '{label}: {token}',
    'ui.asCron': '{label} as cron',
    'ui.pressEnter': 'Press Enter to apply.',
    'ui.clear': 'Clear',
    'ui.clearField':
        'Clear {field, select, second {seconds} minute {minutes} hour {hours} day {day of month} month {months} weekday {day of week} other {years}}',
    'ui.which': 'Which',
    'ui.invalid': 'Enter a valid schedule.',

    /* ---------- Menus ---------- */
    'menu.days': 'Days',
    'section.occurrence': 'Occurrence in the month',
    // The every-day pill in the Days menu, where the heading already names the field. Other presets take the chip's words.
    'preset.everyDay': 'Every day',
    'nth.option': '{k, select, 1 {First} 2 {Second} 3 {Third} 4 {Fourth} 5 {Fifth} other {Last}}',
    'note.exclusive': '{target} uses one day field at a time. Setting one clears the other.',
    'note.either': 'Both day fields are set, so it runs when either one matches.',
    'note.both': 'Both day fields are set, so it runs only when both match.',

    /* ---------- Messages under the field ---------- */
    'message.fieldError': '{label}: {error}',
    'fix.use': 'Use {token}',
    'warning.coversEvery':
        '{token} covers every {field, select, day {day of the month} other {day of the week}}, so the {other, select, day {day of month} other {day of week}} field is ignored.',
    'warning.questionEvery':
        '{target} reads ? as every day, so the {other, select, day {day of month} other {day of week}} field is ignored and this runs every day.',
    'warning.minInterval': '{target} runs a schedule at most every {minutes} minutes.',
    'warning.longStep': 'A step of {step} is longer than the field, so {target} runs it only at {start}.',
    'error.engine': '{target} can’t run this schedule: {detail}',
    'never.monthLacks': '{count, plural, one {{months} never has a {day}.} other {{months} never have a {day}.}}',
    'never.pastYears':
        '{count, plural, one {This schedule won’t run again: {year} has passed.} other {This schedule won’t run again: its last year, {year}, has passed.}}',
    'never.generic': 'This schedule never runs. Check the day and month fields.',

    /* ---------- Formats Intl can't spell ---------- */
    'format.ordinal': '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    'format.minute': ':{minute}',
    'format.second': ':{second}',
    'day.plural': '{day, select, 0 {Sundays} 1 {Mondays} 2 {Tuesdays} 3 {Wednesdays} 4 {Thursdays} 5 {Fridays} other {Saturdays}}',

    /* ---------- The schedule sentence ---------- */
    // Built from clauses: the time of day, then the days, then years and the timezone. Each clause is one message.
    'sentence.end': '{text}.',
    'sentence.days': '{time}{join, select, comma {,} other {}} {days}',
    'sentence.year': '{text}, in {years}',
    'sentence.zone': '{text} ({zone})',
    'sentence.seconds': '{seconds}, {text}',
    'seconds.every': '{n, plural, one {every second} other {every # seconds}}',
    'seconds.at': 'at {seconds} {n, plural, one {second} other {seconds}} past the minute',
    'seconds.pastEveryMinute': 'at {seconds} {n, plural, one {second} other {seconds}} past every minute',
    'time.at': 'at {times}',
    'time.everyNHours': '{n, plural, one {every hour} =2 {every other hour} other {every # hours}}',
    'time.onTheHour': '{base}, on the hour',
    'time.atMinute': '{base} at {minute}',
    'time.between': '{base}, from {start} to {end}',
    'time.minutePastHours': 'at {minute} past {hours}',
    'time.everyNMinutes': '{n, plural, one {every minute} other {every # minutes}}',
    'time.inEveryNthMinute': 'in {n, plural, =2 {every other minute} other {every {nth} minute}}',
    'time.minuteList': '{base} ({minutes})',
    'time.fromTo': '{base} from {start} to {end}',
    'time.starting': '{base}, starting at {start}',
    'time.everyMinuteFromTo': 'every minute from {start} to {end}',
    'time.pastEveryHour': '{base} past every hour',
    'time.everyHour': '{base}, every hour',
    'time.duringHour': '{base}, during the {hour} hour',
    'time.duringHours': '{base}, during the {start}–{end} hours',
    'time.duringStep': '{base}, during {n, plural, =2 {every other hour} other {every {nth} hour}}',
    'time.duringList': '{base}, during the {hours} hours',
    'dom.step':
        '{n, plural, =2 {every other day} other {every # days}}{hasFrom, select, yes { starting on the {from}} other {}}{hasUntil, select, yes { until the {until}} other {}}',
    'dom.on': 'on {dates}',
    'dom.range': 'the {start} through the {end}',
    'dom.first': 'the {day}',
    'dom.last': 'the last day',
    // `n` is the cron offset, 3 in L-3; `nth` counts from the last day, so L-3 is the 4th-to-last.
    'dom.lastOffset': 'the {nth}-to-last day',
    'dom.lastWeekday': 'the last weekday',
    'dom.nearest': 'the weekday nearest the {day}',
    'dow.weekdays': 'on weekdays',
    'dow.weekends': 'on weekends',
    'dow.on': 'on {days}',
    'dow.nth': 'the {k, select, 1 {first} 2 {second} 3 {third} 4 {fourth} other {fifth}} {dayName}',
    'dow.last': 'the last {dayName}',
    'range.through': '{start} through {end}',
    'years.step': 'every {n} years from {start} to {end}',
    'days.ofMonth': '{days} of the month',
    'days.ofMonths': '{days} of {months}',
    'days.inMonths': '{days} in {months}',
    'days.and': 'on {weekdays} that fall on {dates}',
    'days.or': '{dates} of the month, or {weekdays}',
    'days.orIn': '{dates}, or {weekdays}, in {months}',
    'days.everyDayIn': 'every day in {months}',
    'days.in': 'in {months}',
    'days.everyDay': 'every day',

    /* ---------- Chip labels ---------- */
    // Written lowercase; the field capitalizes each finished label.
    'word.timeRange': '{start}–{end}',
    'word.stepBounded': '{every}, {start}–{end}',
    'word.stepStarting': '{every}, starting {start}',
    'word.domStepBounded': 'every {n} days, {start}–{end}',
    'word.domParity': '{parity, select, odd {odd} other {even}} days of the month',
    'word.domStep': 'every {n} days of the month{hasFrom, select, yes {, from the {from}} other {}}',
    'word.domRange': 'on the {start}–{end}',
    'word.domList': 'on the {dates}',
    'word.weekdays': 'weekdays',
    'word.weekends': 'weekends',
    'word.lastDay': 'last day',
    'word.lastOffset': '{nth}-to-last day',
    'word.lastWeekday': 'last weekday',
    'word.nearest': 'weekday nearest the {day}',
    'word.lastDow': 'last {dayName}',
    'word.nth': '{k, select, 1 {first} 2 {second} 3 {third} 4 {fourth} other {fifth}} {dayName}',
    'word.quarterly': '{n, plural, =3 {quarterly} other {every # months}}: starting {month}',
    'word.monthRange': 'in {start}–{end}',
    'word.monthList': 'in {months}',
    'word.yearList': 'in {years}',
    'word.either': '{first}, or {second}',
    'word.both': '{first}, but only {second}',

    /* ---------- Parser errors ---------- */
    'error.typeSchedule': 'Type a schedule, like {example}.',
    'error.unknownShortcut': '{token} isn’t a cron shortcut. Try @daily or @hourly.',
    'error.noShortcuts': '{target} doesn’t read shortcuts like {token}.',
    'error.fieldCount': '{target} needs {count} fields. This has {actual}.',
    'error.empty':
        'Add a value, or * for every {field, select, second {second} minute {minute} hour {hour} day {day} month {month} weekday {day of the week} other {year}}.',
    'error.questionDays': '? only works in the day fields.',
    'error.questionStar': 'Use * here.',
    'error.extraComma': 'Remove the extra comma.',
    'error.invalidPart':
        '“{part}” isn’t valid in the {field, select, second {second} minute {minute} hour {hour} day {day} month {month} weekday {day of the week} other {year}} field.',
    'error.stepRange': 'A step has to be 1 to {max}.',
    'error.starRange': '“{part}” mixes * with a range. Use one or the other.',
    'error.threeLetters': 'Cron only reads three-letter names. Use {short}.',
    'error.unknownValue':
        '“{value}” isn’t a {field, select, second {second} minute {minute} hour {hour} day {day} month {month} weekday {day of the week} other {year}} {target} understands.',
    'error.noNames': '{target} doesn’t read names. Use numbers.',
    'error.outOfRange':
        '{value} is out of range. {field, select, second {Seconds} minute {Minutes} hour {Hours} day {Days} month {Months} weekday {Days of the week} other {Years}} go from {min} to {max}.',
    'error.stepNeedsRange': '{part} needs a range to step through: {example}.',
    'error.sundaySeven': 'Write Sunday as 7 at the end of a range.',
    'error.backwards': '{range} runs backwards. Cron needs it split in two.',
    'error.duplicate': '{value} appears more than once. {target} allows each value only once.',
    'error.unsupported': '{target} doesn’t support {token}.',
    'error.lastOffsetUnsupported': 'Counting back from the last day ({token}) isn’t supported. Use L, or list the days.',
    'error.lastOffsetRange': 'L- can count back 1 to 30 days.',
    'error.lwWhole': 'LW has to be the whole field.',
    'error.nearestRange': 'W needs a day from 1 to 31, like 15W.',
    'error.nearestAlone': 'W works on one day, like 15W, not in a range or with a step.',
    'error.dowLNeedsDay': 'In the day-of-week field, L needs a day: {example} is the last Friday.',
    'error.notWeekday': '“{value}” isn’t a day of the week. Use {min}–{max}{names, select, yes { or SUN–SAT} other {}}.',
    'error.specialAlone': '{target} needs {token} on its own, with nothing else in the field.',
    'error.nthRange': 'After #, use 1 to 5: {example} is the second Monday.',
    'error.bothDays': '{target} can’t use both day fields. Set one to {token}.',
    'error.bothQuestion': 'Only one day field can be ?.',
    'error.needsQuestion': '{target} needs ? in the day field you don’t use.',
} as const

export type MessageId = keyof typeof MESSAGES
export type ErrorId = Extract<MessageId, `error.${string}` | `never.${string}`>
export type WarningId = Extract<MessageId, `warning.${string}`>
