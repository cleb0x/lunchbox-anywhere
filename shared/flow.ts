import type { Every, Flow, FlowStep } from './types'

export const EVERY: { id: Every; name: string }[] = [
  { id: 'hour', name: 'Every hour' },
  { id: 'day', name: 'Every day' },
  { id: 'weekday', name: 'Weekdays' },
  { id: 'week', name: 'Every week' },
]

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// The first time after `from` that the schedule fires, in local time. Hourly flows fire at the
// minute of `at`; the others at its hour and minute.
export function nextRun(f: Pick<Flow, 'every' | 'at' | 'day'>, from = Date.now()): number | undefined {
  if (!f.every) return undefined
  const [h, m] = (f.at ?? '09:00').split(':').map((n) => Number(n) || 0)
  const t = new Date(from)
  t.setSeconds(0, 0)
  if (f.every === 'hour') {
    t.setMinutes(m)
    if (t.getTime() <= from) t.setHours(t.getHours() + 1)
    return t.getTime()
  }
  t.setHours(h, m, 0, 0)
  for (let i = 0; i < 8; i++) {
    const ok =
      f.every === 'day' ||
      (f.every === 'weekday' && t.getDay() >= 1 && t.getDay() <= 5) ||
      (f.every === 'week' && t.getDay() === (f.day ?? 1))
    if (ok && t.getTime() > from) return t.getTime()
    t.setDate(t.getDate() + 1)
    // Set again each day: a time that does not exist on the night the clocks change must not
    // carry its shifted hour into the days after.
    t.setHours(h, m, 0, 0)
  }
  return undefined
}

export function describe(f: Pick<Flow, 'every' | 'at' | 'day'>) {
  if (!f.every) return 'When you run it'
  const at = f.at ?? '09:00'
  if (f.every === 'hour') return `Every hour at :${at.split(':')[1] ?? '00'}`
  if (f.every === 'day') return `Every day at ${at}`
  if (f.every === 'weekday') return `Weekdays at ${at}`
  return `${DAYS[f.day ?? 1]}s at ${at}`
}

// {{date}} is today, {{last}} is what the previous run ended with, so a flow can say
// "what changed since {{last}}" and pick up where it stopped.
export function fill(text: string, vars: { date: string; last?: string; previous?: string }) {
  return text
    .replace(/\{\{\s*date\s*\}\}/g, vars.date)
    .replace(/\{\{\s*last\s*\}\}/g, vars.last?.trim() || 'nothing yet, this is the first run')
    .replace(/\{\{\s*previous\s*\}\}/g, vars.previous?.trim() || 'nothing yet, this is the first step')
}

export type Group = 'code' | 'research' | 'writing' | 'business' | 'personal'
export const GROUPS: { id: Group; name: string }[] = [
  { id: 'code', name: 'Code' },
  { id: 'research', name: 'Research' },
  { id: 'writing', name: 'Writing' },
  { id: 'business', name: 'Business' },
  { id: 'personal', name: 'Personal' },
]

export type Template = { id: string; name: string; line: string; group: Group; steps: FlowStep[]; every?: Every; at?: string; day?: number; pack?: string; crew: string[] }

// Every template works on the folder the flow runs in. Steps without `to` go to whoever the room
// routes them to. {{last}} carries the previous run's ending, so weekly flows compare themselves.
export const TEMPLATES: Template[] = [
  // Code
  {
    id: 'nightly-check', group: 'code', name: 'Nightly tests, types and lint', line: 'Runs the checks each weeknight, fixes what fails and reviews each fix',
    every: 'weekday', at: '02:00', crew: ['codex', 'claude'], pack: 'software',
    steps: [
      { to: 'codex', text: 'Run the project\'s tests, type check and linter. Fix anything that fails with the smallest change, then run the check again to prove it.' },
      { to: 'claude', text: 'Review the fixes as a strict senior engineer. Undo any fix that hides a problem (a skipped test, a loosened assertion, a cast), and say what a person should look at.' },
    ],
  },
  {
    id: 'ci-health', group: 'code', name: 'Daily CI health', line: 'Which CI runs failed since yesterday and why, with a fix branch for the first one',
    every: 'weekday', at: '08:30', crew: ['codex', 'claude'], pack: 'software',
    steps: [
      { to: 'codex', text: 'List the CI runs on the main branch and on open pull requests from the last 24 hours (`gh run list --limit 40`). For each failed run, read the failed log (`gh run view <id> --log-failed`) and name the first real error. Reproduce the failure on the main branch locally if there is one, and fix it on a new branch with the checks run again as proof. Push nothing.' },
      { to: 'claude', text: 'Write the morning report: runs passed and failed, each failure with its cause in one line and whether it is the code, a flaky test or the workflow, and the state of the fix branch. Mark any failure that also appeared in the last report: {{last}}' },
    ],
  },
  {
    id: 'flaky-report', group: 'code', name: 'Nightly flaky test report', line: 'Runs the test suite ten times overnight and lists the tests that sometimes fail',
    every: 'weekday', at: '01:00', crew: ['codex', 'claude'], pack: 'software',
    steps: [
      { to: 'codex', text: 'Run the full test suite ten times in a row without changing any code, and once more in random order if the test runner supports it. Record each test that failed in some runs and passed in others, with how many times it failed and the output of one failure. Fix nothing.' },
      { to: 'claude', text: 'For each flaky test, read the test and the code under it and name the likely cause: timing, shared state, order, network or the clock. Write the report as a table sorted by failure count, and mark the tests that are new since the last report: {{last}}' },
    ],
  },
  {
    id: 'deps', group: 'code', name: 'Weekly dependency updates', line: 'Patch and minor upgrades on a branch with the tests run, major ones explained',
    every: 'week', day: 1, at: '07:00', crew: ['codex', 'claude'], pack: 'software',
    steps: [
      { to: 'codex', text: 'List outdated and vulnerable dependencies. On a new branch named deps/{{date}}, apply patch and minor upgrades in small groups, run the tests after each group, and revert any group that breaks them. Commit what passes.' },
      { to: 'claude', text: 'Read the changelog of each package that moved and check the diff of the lockfile for anything unexpected. Write a pull request description: what was upgraded, what was held back and why. For each major upgrade left, write two lines: what breaks for us and how long the move takes. Open the pull request with `gh pr create` if gh is signed in, otherwise leave the branch and print the description. Last week: {{last}}' },
    ],
  },
  {
    id: 'stale', group: 'code', name: 'Stale branches and PRs digest', line: 'Pull requests waiting over a week and branches untouched for a month, each Monday',
    every: 'week', day: 1, at: '09:00', crew: ['claude'], pack: 'software',
    steps: [{ text: 'List the open pull requests with no activity for seven days or more (`gh pr list --json number,title,author,updatedAt,reviewDecision,isDraft`) and the remote branches with no commit for 30 days (`git for-each-ref --sort=committerdate refs/remotes`). For each pull request say who it waits on: a review, the author or CI. For each branch say whether it is merged into main and safe to delete. Write a digest with the three items to deal with first. Delete and close nothing. Last digest: {{last}}' }],
  },
  {
    id: 'pr-queue', group: 'code', name: 'Morning review of open PRs', line: 'Reads each pull request opened or updated since yesterday and drafts review notes',
    every: 'weekday', at: '08:00', crew: ['claude', 'codex'], pack: 'review',
    steps: [
      { to: 'codex', text: 'List the open pull requests updated in the last 24 hours (`gh pr list --json number,title,author,updatedAt`). Skip drafts. For each of the first five, check it out, run the tests and the build, and record what passed and failed. Return to the branch you started on.' },
      { to: 'claude', text: 'Read the diff of each of those pull requests with the code around it. Write review notes per pull request: what it does, bugs and unhandled cases with file and line, missing tests, and a verdict. Save them to reviews/{{date}}.md. Post nothing to GitHub.' },
    ],
  },
  {
    id: 'changelog', group: 'code', name: 'Weekly changelog draft', line: 'This week\'s commits written for users and added to the top of CHANGELOG.md',
    every: 'week', day: 5, at: '15:00', crew: ['claude'],
    steps: [{ text: 'Read this week\'s commits and merged pull requests. Write a changelog entry for users, grouped as New, Improved and Fixed. Leave out internal refactors. Add it at the top of CHANGELOG.md under today\'s date, {{date}}, and leave it uncommitted for me to edit.' }],
  },
  {
    id: 'standup', group: 'code', name: 'Standup notes from git', line: 'Yesterday\'s commits written up as shipped, in progress and blocked',
    every: 'weekday', at: '09:30', crew: ['claude'],
    steps: [{ text: 'Read the git log and diffs from the last working day in this folder. Write a standup update: what shipped, what is in progress, what is blocked. Plain words, no commit hashes.' }],
  },
  {
    id: 'test-gaps', group: 'code', name: 'Weekly tests for untested code', line: 'Picks three important code paths without tests each week and writes tests for them',
    every: 'week', day: 4, at: '02:00', crew: ['codex', 'claude'], pack: 'software',
    steps: [
      { to: 'claude', text: 'Find the most important code paths with no tests: payments, auth, data writes, anything a user touches. Pick three that last week did not cover: {{last}}' },
      { to: 'codex', text: 'Write focused tests for those three paths and run them. If a test finds a real bug, stop and describe the bug, and leave the test as it is.' },
    ],
  },
  {
    id: 'security', group: 'code', name: 'Weekly security review', line: 'Secrets, injection and missing auth checks reviewed, the top three fixed with tests',
    every: 'week', day: 2, at: '03:00', crew: ['claude', 'codex'], pack: 'security',
    steps: [
      { to: 'claude', text: 'Review this codebase for committed secrets, injection, unsafe deserialisation, missing auth checks and unvalidated input. Run the package manager\'s audit for known vulnerabilities. Rank findings by how easy they are to exploit.' },
      { to: 'codex', text: 'Fix the top three findings with tests that fail before the fix and pass after. Compare with last week: {{last}}' },
    ],
  },
  {
    id: 'docs', group: 'code', name: 'Check the docs against the code', line: 'Runs each command and sample in the README and docs, then fixes the ones that fail',
    every: 'week', day: 5, at: '11:00', crew: ['codex', 'claude'],
    steps: [
      { to: 'codex', text: 'Run each command and code sample in the README and docs. Note which ones fail or print something different.' },
      { to: 'claude', text: 'Fix the docs to match what the code does now, and list the places where the code looks wrong and the docs look right.' },
    ],
  },
  {
    id: 'todo-sweep', group: 'code', name: 'TODO sweep', line: 'Fixes the TODO and FIXME comments that take ten minutes and lists the rest by risk',
    every: 'week', day: 3, at: '10:00', crew: ['codex', 'claude'], pack: 'software',
    steps: [
      { to: 'codex', text: 'Find each TODO, FIXME and HACK comment. Fix the ones that take under ten minutes and prove each fix with the tests.' },
      { to: 'claude', text: 'List the rest by risk, with the file and one line on what it would take.' },
    ],
  },
  {
    id: 'site-qa', group: 'code', name: 'Daily website check', line: 'Opens each page of your site on desktop and phone and reports errors with screenshots',
    every: 'day', at: '06:30', crew: ['claude'], pack: 'software',
    steps: [{ text: 'Open the site this folder builds in the Lunchbox browser. Visit each page linked from the home page at desktop and phone sizes. Report console errors, broken links, layout breaks and slow pages, with screenshots. Mark what is new since the last run: {{last}}' }],
  },

  // Research
  {
    id: 'x-digest', group: 'research', name: 'Morning X digest', line: 'The ten most discussed posts on your topics overnight, as a five minute read',
    every: 'day', at: '08:00', crew: ['grok', 'claude'], pack: 'research',
    steps: [
      { to: 'grok', text: 'Search X for the most discussed posts in the last 24 hours about the topics in this folder\'s brief. List the ten that matter, with links and why.' },
      { to: 'claude', text: 'Turn that into a five minute morning read: three themes, the posts behind each, and one thing worth replying to. Compare with the last digest: {{last}}' },
    ],
  },
  {
    id: 'competitors', group: 'research', name: 'Weekly competitor watch', line: 'What each competitor announced, shipped or repriced this week, and what to do about it',
    every: 'week', day: 5, at: '16:00', crew: ['grok', 'antigravity', 'claude'], pack: 'research',
    steps: [
      { to: 'grok', text: 'What did the competitors named in this folder\'s brief announce or ship this week? Check X and the web, with links.' },
      { to: 'antigravity', text: 'Check their sites, pricing pages and changelogs for changes the posts missed. Record each plan and price so next week can compare.' },
      { to: 'claude', text: 'Summarise what matters for us and what we should do about it, with a table of their current prices next to ours. Last week: {{last}}' },
    ],
  },
  {
    id: 'papers', group: 'research', name: 'Weekly new papers', line: 'Five papers from the last seven days on your topics, each summed up in three lines',
    every: 'week', day: 1, at: '08:00', crew: ['antigravity', 'claude'], pack: 'research',
    steps: [
      { to: 'antigravity', text: 'Find papers from the last seven days on the topics in this folder\'s brief, on arXiv and the main venues. Keep the five with the strongest results.' },
      { to: 'claude', text: 'For each: the claim in one sentence, how they tested it, and whether it changes anything for us. Skip anything already covered: {{last}}' },
    ],
  },
  {
    id: 'market', group: 'research', name: 'Daily market brief', line: 'Yesterday\'s launches, price changes and funding in one market, in five bullets',
    every: 'weekday', at: '07:30', crew: ['grok', 'claude'], pack: 'research',
    steps: [
      { to: 'grok', text: 'What moved yesterday in the market named in this folder\'s brief: launches, price changes, funding, and what people on X made of it.' },
      { to: 'claude', text: 'Write it as five bullets with sources, then one line on what to watch today.' },
    ],
  },

  // Writing
  {
    id: 'blog-draft', group: 'writing', name: 'Weekly blog post draft', line: 'A 700 word draft on this week\'s debate in your field, saved to drafts/',
    every: 'week', day: 2, at: '07:00', crew: ['grok', 'claude'], pack: 'writing',
    steps: [
      { to: 'grok', text: 'What are people in our field arguing about this week? Find one question with real disagreement and the best posts on each side.' },
      { to: 'claude', text: 'Draft a 700 word post that takes a side, using notes and past posts in this folder for voice. Save it to drafts/ with today\'s date: {{date}}.' },
    ],
  },
  {
    id: 'newsletter', group: 'writing', name: 'Weekly newsletter issue', line: 'This week\'s notes and commits written as an issue of under 600 words',
    every: 'week', day: 4, at: '10:00', crew: ['claude', 'grok'], pack: 'writing',
    steps: [
      { text: 'Collect what happened this week from the notes, commits and documents in this folder.' },
      { to: 'grok', text: 'Add two links from the wider field that readers would want.' },
      { to: 'claude', text: 'Write the issue: a short opening, three sections, the links, one ask. Keep it under 600 words. Last issue for continuity: {{last}}' },
    ],
  },
  {
    id: 'thread', group: 'writing', name: 'X thread about what you shipped', line: 'Picks the recent change a stranger would care about and writes six posts on it',
    crew: ['claude', 'grok'],
    steps: [
      { to: 'claude', text: 'Read what changed in this folder recently and pick the one thing a stranger would care about.' },
      { to: 'grok', text: 'Write it as a thread of at most six posts, the way people who do well on X write: the result first, then how, then proof. Offer two opening posts to choose from.' },
    ],
  },

  // Business
  {
    id: 'seo-week', group: 'business', name: 'Weekly SEO check', line: 'Site issues ranked by impact, the top three fixed, and five search opportunities',
    every: 'week', day: 1, at: '09:00', crew: ['claude', 'antigravity', 'grok'], pack: 'seo',
    steps: [
      { text: 'Audit the site in this folder: titles, descriptions, headings, broken links, missing alt text and structured data. Rank the issues by impact.' },
      { to: 'grok', text: 'What are people searching for and saying this week about the topics this site covers? Five opportunities with evidence.' },
      { text: 'Fix the three issues with the highest impact and write the week\'s report. Last week\'s report for comparison: {{last}}' },
    ],
  },
  {
    id: 'leads', group: 'business', name: 'Weekly lead list', line: 'Ten new companies that fit your customer profile, each with a first message drafted',
    every: 'week', day: 1, at: '08:30', crew: ['antigravity', 'grok', 'claude'], pack: 'research',
    steps: [
      { to: 'antigravity', text: 'Using the ideal customer in this folder\'s brief, find ten companies that fit and are not already in leads.csv. Website, size, and the signal that makes them a fit now.' },
      { to: 'grok', text: 'Check each on X for recent posts by the company or its founders that would make a good opening line.' },
      { to: 'claude', text: 'Append them to leads.csv and draft a first message of three sentences for each. Do not send anything.' },
    ],
  },
  {
    id: 'reviews', group: 'business', name: 'Weekly customer feedback', line: 'Public posts and reviews naming your product, sorted into praise, complaints and requests',
    every: 'week', day: 5, at: '12:00', crew: ['grok', 'claude'], pack: 'research',
    steps: [
      { to: 'grok', text: 'Find this week\'s posts, reviews and threads that mention our product by name. Quote them with links.' },
      { to: 'claude', text: 'Group them into praise, complaints and requests. Name the one fix that would change the most minds. Last week: {{last}}' },
    ],
  },
  {
    id: 'metrics', group: 'business', name: 'Monday metrics report', line: 'Last week\'s numbers from the exports in this folder against the week before',
    every: 'week', day: 1, at: '07:30', crew: ['claude'], pack: 'data',
    steps: [{ text: 'Read the exports and spreadsheets in this folder. Report last week\'s key numbers against the week before, explain the biggest change, and flag anything that looks like a data error. Previous report: {{last}}' }],
  },

  // Personal
  {
    id: 'inbox-notes', group: 'personal', name: 'Weekly notes cleanup', line: 'Merges duplicate notes, titles and links them, and writes open threads to WEEK.md',
    every: 'week', day: 0, at: '18:00', crew: ['claude'],
    steps: [{ text: 'Read the notes in this folder written this week. Merge duplicates, give each a clear title, link related notes, and write a one page summary of open threads to WEEK.md. Keep each note; delete none.' }],
  },
  {
    id: 'learning', group: 'personal', name: 'Daily ten minute lesson', line: 'A short lesson with one exercise on the topic in learning.md, building on yesterday',
    every: 'weekday', at: '07:00', crew: ['claude', 'antigravity'], pack: 'learn',
    steps: [
      { to: 'antigravity', text: 'Read learning.md in this folder for the topic and what was covered so far, and find one good source for the next step.' },
      { to: 'claude', text: 'Write a ten minute lesson with one exercise, building on yesterday: {{last}}. Append a line to learning.md about what this lesson covered.' },
    ],
  },
  {
    id: 'trip', group: 'personal', name: 'Plan a trip', line: 'Flights, three places to stay and a plan for each day inside the budget in trip.md',
    crew: ['antigravity', 'grok', 'claude'],
    steps: [
      { to: 'antigravity', text: 'Read trip.md in this folder for where, when and the budget. Find flight options and three places to stay in the best areas, with prices and links.' },
      { to: 'grok', text: 'What are locals and recent visitors recommending right now? Food, things to skip, and anything happening on those dates.' },
      { to: 'claude', text: 'Write a plan for each day inside the budget, with the bookings to make first. Save it to trip-plan.md.' },
    ],
  },
]
