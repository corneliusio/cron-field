/*
 * What each platform without a parser library documents: values, whether the platform takes them, and the rule from
 * its docs that says so, quoted where the docs are explicit, so each row can be checked against its source.
 */
import type { TargetName } from '../../src/index.ts'

export type Row = [value: string, expect: 'accept' | 'reject', rule: string]
export type Platform = { source: string; rows: Row[]; pins: string[] }

const QUARTZ_API = 'https://www.quartz-scheduler.org/api/2.3.0/org/quartz/CronExpression.html'

export const PLATFORMS: Record<Exclude<TargetName, 'croner' | 'cron-parser' | 'effect'>, Platform> = {
    vixie: {
        source: 'https://man7.org/linux/man-pages/man5/crontab.5.html',
        rows: [
            ['0 0 */2 * 1', 'accept', '"If both fields are restricted (i.e., do not contain the "*" character)…" either may match'],
            ['0 0 3 * 1', 'accept', '"If both fields are restricted (i.e., do not contain the "*" character)…" either may match'],
            ['0 9 * jan-mar mon-fri', 'accept', '"case does not matter"; "Ranges and lists of names are allowed."'],
            ['0 0 * * 7', 'accept', 'day of week "0-7 (0 or 7 is Sunday, or use names)"'],
            ['*/2 * * * *', 'accept', '"Step values are also permitted after an asterisk"'],
            ['5/15 * * * *', 'reject', '"Following a range with "/<number>" specifies skips": a step follows a range or *'],
            ['@daily', 'accept', '"@daily: Run once a day, ie. "0 0 * * *""'],
            ['@reboot', 'reject', '"@reboot: Run once after reboot": not a schedule, refused by design'],
            ['0 9 L * *', 'reject', 'no L, W or # in the man page'],
        ],
        pins: [],
    },
    vercel: {
        source: 'https://vercel.com/docs/cron-jobs#cron-expressions',
        rows: [
            ['5 * * * *', 'accept', 'example: "Triggers at 5 minutes past the hour"'],
            ['0 5 1 * *', 'accept', 'day of month "1 - 31"'],
            ['0 5 * * 0', 'accept', 'day of week "0 - 6 (Sun-Sat)"'],
            ['0 5 * * 7', 'reject', 'day of week "0 - 6 (Sun-Sat)"'],
            ['0 5 * * MON', 'reject', '"do not support alternative expressions like MON, SUN, JAN, or DEC"'],
            ['0 5 * JAN *', 'reject', '"do not support alternative expressions like MON, SUN, JAN, or DEC"'],
            ['0 5 1 * 1', 'reject', '"When one has a value, the other must be *"'],
            ['*/5 * * * *', 'accept', 'operators aren’t listed; assumed standard'],
            ['@daily', 'reject', 'not in the format table'],
            ['0 5 L * *', 'reject', 'not in the format table'],
            ['0 5 ? * 1', 'reject', 'not in the format table'],
        ],
        pins: [],
    },
    cloudflare: {
        source: 'https://developers.cloudflare.com/workers/configuration/cron-triggers/#supported-cron-expressions',
        rows: [
            ['0 17 * * sun', 'accept', 'example: 17:00 on Sunday'],
            ['0 17 * * 1', 'accept', '"Days of the week go from 1 = Sunday to 7 = Saturday"'],
            ['10 7 * * mon-fri', 'accept', 'example: 07:10 on weekdays'],
            ['10 7 * * 2-6', 'accept', 'example: 07:10 on weekdays'],
            ['0 18 * * 6L', 'accept', 'example: 18:00 on the last Friday of the month'],
            ['0 18 * * friL', 'accept', 'example: 18:00 on the last Friday of the month'],
            ['59 23 LW * *', 'accept', 'example: 23:59 on the last weekday of the month'],
            ['0 9 15W * *', 'accept', 'L and W in the day of month'],
            ['0 9 * * 2#1', 'accept', 'L and # in the day of week'],
            ['0 9 * * 0', 'reject', 'weekdays 1-7'],
            ['0 9 ? * 2', 'reject', 'no ? among the special characters'],
            ['0 9 L-3 * *', 'reject', 'only L and LW in the day of month'],
            ['@daily', 'reject', 'five fields; no shortcuts'],
        ],
        pins: [],
    },
    github: {
        source: 'https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule',
        rows: [
            ['20/15 * * * *', 'accept', 'example: "every 15 minutes starting from minute 20 through 59"'],
            ['0 9 * JAN-DEC SUN-SAT', 'accept', 'month "1 - 12 or JAN-DEC", day of week "0 - 6 or SUN-SAT"'],
            ['0 9 * * 7', 'reject', 'day of week "0 - 6 or SUN-SAT"'],
            ['*/2 * * * *', 'accept', '"The shortest interval… is once every 5 minutes": a warning, not an error'],
            ['@daily', 'reject', '"does not support the non-standard syntax @yearly, @monthly, @weekly, @daily, @hourly, and @reboot"'],
            ['@reboot', 'reject', '"does not support the non-standard syntax @yearly, @monthly, @weekly, @daily, @hourly, and @reboot"'],
            ['0 9 L * *', 'reject', 'operators are *, ",", - and /'],
            ['0 9 * * 1#1', 'reject', 'operators are *, ",", - and /'],
            ['0 9 ? * 1', 'reject', 'operators are *, ",", - and /'],
        ],
        pins: [],
    },
    quartz: {
        source: 'https://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html',
        rows: [
            ['0 15 10 ? * *', 'accept', 'example: "Fire at 10:15am every day"'],
            ['0 15 10 * * ?', 'accept', 'example: "Fire at 10:15am every day"'],
            ['0 0/5 14 * * ?', 'accept', 'example: "Fire every 5 minutes starting at 2pm and ending at 2:55pm"'],
            ['0 10,44 14 ? 3 WED', 'accept', 'example: "Fire at 2:10pm and at 2:44pm every Wednesday in the month of March"'],
            ['0 15 10 L-2 * ?', 'accept', 'example: "the 2nd-to-last last day of every month"'],
            ['0 15 10 ? * 6#3', 'accept', 'example: "the third Friday of every month"'],
            ['0 0 12 1/5 * ?', 'accept', 'example: "every 5 days every month, starting on the first day of the month"'],
            ['0 15 10 * * ? 2005', 'accept', 'example: "every day during the year 2005"; the year field is optional'],
            ['0 0 9 ? * L', 'accept', '"If used in the day-of-week field by itself, it simply means "7" or "SAT""'],
            ['0 0 9 1-5W * ?', 'reject', '"The \'W\' character can only be specified when the day-of-month is a single day"'],
            ['0 0 9 * * *', 'reject', '"?"… useful when you need to specify something in one of the two fields… but not the other'],
            ['0 0 9 1 * 2', 'reject', '"?"… useful when you need to specify something in one of the two fields… but not the other'],
            ['0 0 9 ? * ?', 'reject', '"?"… useful when you need to specify something in one of the two fields… but not the other'],
            ['0 0 9 ? * 1,6L', 'reject', '"When using the \'L\' option, it is important not to specify lists, or ranges of values"'],
            ['0 0 0 1,L * ?', 'reject', '"When using the \'L\' option, it is important not to specify lists, or ranges of values"'],
            ['0 0 0 ? * 3#1,6#3', 'reject', `"there can only be one expression in the day-of-week field" with # (${QUARTZ_API})`],
            ['0 0 22-2 ? * 2', 'accept', `overflowing ranges such as 22-2 are supported (${QUARTZ_API})`],
        ],
        pins: [
            // The field doesn't offer Quartz's optional seventh field, the year: Quartz values have six fields here.
            '0 15 10 * * ? 2005: docs accept, profile rejects',
        ],
    },
    eventbridge: {
        source: 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-scheduled-rule-pattern.html#eb-cron-expressions',
        rows: [
            ['0 10 * * ? *', 'accept', 'example: "Run at 10:00 am (UTC+0) every day"'],
            ['0 18 ? * MON-FRI *', 'accept', 'example: "Run at 6:00 pm (UTC+0) every Monday through Friday"'],
            ['0/15 * * * ? *', 'accept', 'example: "Run every 15 minutes"'],
            ['0/30 20-2 ? * MON-FRI *', 'accept', 'example: "between 8:00 pm on the starting day to 2:00 am on the following day"'],
            ['15 10 ? * 6L 2019-2022', 'accept', 'example: "the last Friday of each month during the years 2019 to 2022"'],
            ['0 9 ? * L *', 'accept', '"The L wildcard in the Day-of-month or Day-of-week fields specifies the last day of the month or week"'],
            ['0 9 ? * 2,L *', 'reject', 'the docs only show L on its own; read cautiously'],
            ['0 9 ? * 1/2 *', 'reject', 'Day-of-week wildcards are ", - * ? L #": no /'],
            ['0 9 ? * 3#1,6#3 *', 'reject', '"3#1,6#3" is not valid because it is interpreted as two expressions'],
            ['0 9 * * * *', 'reject', '"You can\'t use * in both the Day-of-month and Day-of-week fields"'],
            ['0 9 1 * 2 *', 'reject', '"You can\'t specify the Day-of-month and Day-of-week fields in the same cron expression"'],
            ['0 9 1 * ? 2200', 'reject', 'year "1970-2199"'],
            ['0 9 1 * ? 1969', 'reject', 'year "1970-2199"'],
        ],
        pins: [],
    },
}
