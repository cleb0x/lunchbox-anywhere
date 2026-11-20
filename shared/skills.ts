// Playbooks that ship with Lunchbox. Each starts a room with a prompt that already knows how good
// work of that kind is done; {{input}} is replaced with what the person types after picking it.

export type Field = 'Build' | 'Fix' | 'Test' | 'Ship' | 'Design' | 'Research' | 'Write' | 'Grow' | 'Data' | 'Security' | 'Learn' | 'Run'

export type Playbook = {
  id: string
  name: string
  field: Field
  line: string
  prompt: string
  ask?: string
  crew?: string[]
  pack?: string
  tools?: string[]
}

export const FIELDS: Field[] = ['Build', 'Fix', 'Test', 'Ship', 'Design', 'Research', 'Write', 'Grow', 'Data', 'Security', 'Learn', 'Run']

export const PLAYBOOKS: Playbook[] = [
  // Build
  {
    id: 'feature', name: 'Build a feature', field: 'Build', line: 'A short plan, the feature in small steps, tests, and proof that it runs', pack: 'software', ask: 'What should it do?',
    prompt: 'Build this: {{input}}\n\nRead the code around it first and write a short checklist plan. Build it in small steps that each leave the project working. Add or update tests, run the project\'s own checks, and finish by showing it working (a command, a test run or a browser screenshot).',
  },
  {
    id: 'mvp', name: 'Start a new app from one sentence', field: 'Build', line: 'A first version that runs, with a README and a screenshot of the main screen', pack: 'software', ask: 'Describe the app',
    prompt: 'Make a working first version of: {{input}}\n\nPick the simplest stack that fits and say why in one line. Scaffold it in this folder, build the core flow from start to finish before anything else, and add a README with how to run it. Start it, open it in the Lunchbox browser and take a screenshot of the main screen.',
    tools: ['shadcn'],
  },
  {
    id: 'api', name: 'Add an API endpoint', field: 'Build', line: 'The route, input validation, tests and docs, written the way this codebase does it', pack: 'software', ask: 'What should the endpoint do?',
    prompt: 'Add an API endpoint that {{input}}.\n\nRead two existing endpoints first and follow their routing, validation and error conventions. Validate input at the edge, return errors a client can act on, write tests for the happy path and the two most likely failures, and document it where the other endpoints are documented.',
  },
  {
    id: 'cli', name: 'Build a command line tool', field: 'Build', line: 'A command with flags, help text, JSON output and tests', pack: 'software', ask: 'What should the command do?',
    prompt: 'Write a command line tool that {{input}}.\n\nGive it --help with examples, exit code 0 on success and a distinct code per kind of failure, and output that people can read and scripts can parse with --json. Answer bad input with one clear line and keep stack traces behind a debug flag. Add tests and a short usage section to the README.',
  },
  {
    id: 'refactor', name: 'Refactor a module, tests green', field: 'Build', line: 'One module restructured in small steps, with the tests run after each step', pack: 'software', crew: ['claude', 'codex'], ask: 'Which module, and what bothers you about it?',
    prompt: 'Refactor {{input}}.\n\nRun the tests first and record the result. If the module has thin coverage, add tests that pin its current behaviour before you change anything. Then restructure in small steps: one rename, extraction or move at a time, with the tests run after each step. Keep the public interface and the behaviour the same, and list any caller you had to touch. Finish with the full test suite and a summary of what moved where.',
  },
  {
    id: 'migrate', name: 'Upgrade a dependency', field: 'Build', line: 'The changelog read for breaking changes, the upgrade made, breaks fixed, tests run', pack: 'software', crew: ['claude', 'codex'], ask: 'Which package, to which version?',
    prompt: 'Upgrade {{input}}.\n\nRead the official migration guide and the changelog for each version between the installed one and the target (use the docs tools if connected). List the breaking changes that touch this codebase, with the files they hit. Upgrade on a new branch, fix each break, then run the full test suite and the build. Summarise what changed, what you could not verify locally, and what to watch in production.',
    tools: ['context7'],
  },
  {
    id: 'port', name: 'Port code to another stack', field: 'Build', line: 'The same behaviour in a new language or framework, checked by the same tests', pack: 'software', ask: 'From what to what?',
    prompt: 'Port {{input}}.\n\nFirst write down the behaviour that must stay the same, with tests in the old version where they are missing. Port module by module, keep the same tests passing on the new side, and list anything that has no direct equivalent.',
  },
  // Fix
  {
    id: 'bug', name: 'Fix a bug', field: 'Fix', line: 'A failing test that shows the bug, the cause explained, the fix, the test passing', pack: 'software', ask: 'What goes wrong?',
    prompt: 'Fix this bug: {{input}}\n\nReproduce it first with a failing test or a command. Find the root cause and explain it in two sentences. Make the smallest fix that removes the cause, run the failing test again to prove it passes, then run the rest of the suite.',
  },
  {
    id: 'issue', name: 'Fix a bug from an issue', field: 'Fix', line: 'A GitHub issue reproduced, fixed on a branch and ready as a pull request', pack: 'software', ask: 'Issue link or number',
    prompt: 'Fix the bug reported in this issue: {{input}}\n\nRead the issue and its comments (with the GitHub tools if connected, otherwise `gh issue view`). Write down the expected and the actual behaviour in one line each. Reproduce it with a failing test; if you cannot reproduce it, stop and say what information is missing. Fix the cause on a new branch, run the full suite, and write a pull request description that links the issue and says how the fix was tested. Push or open the pull request only if I ask.',
    tools: ['github'],
  },
  {
    id: 'ci', name: 'Fix a failing CI run', field: 'Fix', line: 'The first real failure in the latest CI log found, fixed and rerun locally', pack: 'software',
    prompt: 'CI is failing on this branch. Read the log of the latest failed run (`gh run list --status failure --limit 1`, then `gh run view <id> --log-failed`, or the GitHub tools if connected). Find the first real failure; later errors often follow from it. Say whether the cause is the code, a test, the workflow file or the environment. Fix it, and leave the tests as strict as they were: no skips, no loosened assertions. Run the same commands locally to prove they pass.',
    tools: ['github'],
  },
  {
    id: 'crash', name: 'Find the cause of an error', field: 'Fix', line: 'Paste an error or stack trace and get the code path, the cause and a fix', pack: 'software', ask: 'Paste the error or stack trace',
    prompt: 'This error happened:\n\n{{input}}\n\nFind the code path that produces it, explain what state leads there, and propose the fix. If it can be reproduced locally, write a test that shows it, then fix it.',
  },
  {
    id: 'perf', name: 'Profile and fix something slow', field: 'Fix', line: 'An endpoint, page or command measured, its biggest cost fixed, then measured again', pack: 'software', ask: 'What is slow?',
    prompt: 'Make this faster: {{input}}\n\nMeasure before touching anything and record the number with the exact command. Find where the time goes with a profiler or timing (for a page, a performance trace in the browser; for an endpoint, timing per query and per call). Fix the biggest cost first and measure again. Report before and after, and stop when the next fix would cost more than it saves.',
    tools: ['devtools'],
  },
  {
    id: 'types', name: 'Fix type errors', field: 'Fix', line: 'The type checker run until it is clean, without casts or ignore comments', pack: 'software',
    prompt: 'Run the type checker and fix each error at its source. Avoid `any`, `as unknown as` and ignore comments; where one is the only way, say why in a comment. Run the checker again until it is clean, then run the tests.',
  },
  // Test
  {
    id: 'tests', name: 'Write tests for untested code', field: 'Test', line: 'Tests for the behaviour that would hurt most if it broke, in the project\'s test style', pack: 'software', crew: ['codex', 'claude'], ask: 'Which part of the code?',
    prompt: 'Add tests for {{input}}.\n\nRead the code and list the behaviours that would hurt most if they broke. Test those, including edge cases and failures, in the project\'s existing test style. A good test fails when the behaviour breaks: check three of them by breaking the code on purpose, then restore it. If a test exposes a real bug, describe the bug and leave the test failing.',
  },
  {
    id: 'flaky', name: 'Hunt a flaky test', field: 'Test', line: 'The test looped until it fails, the cause removed, then 30 clean runs as proof', pack: 'software', ask: 'Which test?',
    prompt: 'This test is flaky: {{input}}\n\nRun it in a loop until it fails and capture the failing output. Run it alone and with the rest of its file to see whether order matters. Find the cause (timing, shared state, order, network, randomness, the clock) and fix that cause. A sleep or a retry hides the cause and does not count as a fix. Prove it with 30 passing runs in a row.',
  },
  {
    id: 'e2e', name: 'Write an end to end test', field: 'Test', line: 'A browser test that walks one user flow and passes three runs in a row', pack: 'software', ask: 'Which user flow?',
    prompt: 'Write an end to end test for this flow: {{input}}\n\nStart the app and walk the flow in the Lunchbox browser first to learn the real selectors. Write the test with the project\'s e2e tool (Playwright if there is none), and select by role and label where you can. Run it until it passes three times in a row.',
    tools: ['playwright'],
  },
  {
    id: 'qa', name: 'QA a website', field: 'Test', line: 'Each page opened on desktop and phone, with a ranked list of what is broken', ask: 'Which URL?',
    prompt: 'QA {{input}} in the Lunchbox browser. Check each page reachable from the navigation on desktop, then the main pages at phone width. Look for broken links, layout breaks, console errors, missing alt text, slow pages and confusing copy. Take a screenshot of each problem and write a ranked list with steps to reproduce.',
    tools: ['playwright'],
  },
  // Ship
  {
    id: 'review', name: 'Review the current diff', field: 'Ship', line: 'Your uncommitted changes read by two agents, with bugs listed by file and line', pack: 'review', crew: ['claude', 'codex'],
    prompt: 'Review the uncommitted changes in this folder (`git diff` and `git diff --staged`), and the last commit if the tree is clean. Read the code around each change so you judge it in context. Look for bugs, unhandled cases, missing tests, security issues and names that mislead. Run the tests and the type check. Give each finding a file and line, how sure you are, and a concrete fix, ordered by how much it matters. Change no files. End with a clear verdict: ship, or fix these first.',
  },
  {
    id: 'pr-review', name: 'Review a pull request', field: 'Ship', line: 'A pull request checked out, tested and reviewed, with comments ready to post', pack: 'review', crew: ['claude', 'codex'], ask: 'Pull request link or number',
    prompt: 'Review this pull request: {{input}}\n\nRead its description and diff (`gh pr view` and `gh pr diff`, or the GitHub tools if connected), then check the branch out and run the tests and the build. Read the code around each change. Check that the change does what the description says, then look for bugs, unhandled cases, missing tests, security issues and anything that breaks existing callers. Write the review as comments with file and line, each marked as blocking or optional, and a summary with a verdict. Post nothing to GitHub unless I ask.',
    tools: ['github'],
  },
  {
    id: 'pr', name: 'Write the pull request description', field: 'Ship', line: 'A title, summary and testing notes written from this branch\'s diff', pack: 'software',
    prompt: 'Write a pull request for the changes on this branch compared to the main branch. Read the full diff first. A short title in the imperative, a summary of what changed and why, how it was tested, and what the reviewer should look at closely. Open it with the GitHub tools if connected, otherwise print it.',
    tools: ['github'],
  },
  {
    id: 'api-review', name: 'Review an API design', field: 'Ship', line: 'Naming, errors, pagination, versioning and breaking changes checked before release', pack: 'review', crew: ['claude', 'antigravity'], ask: 'Which API? A spec file, a route folder or a description',
    prompt: 'Review the design of this API before it ships: {{input}}\n\nRead the spec or the route code and compare it with the existing endpoints. Check naming and consistency, resource shapes, status codes and the error format, pagination and filtering, auth on each route, idempotency of writes, versioning, and anything that would break a current client. For each finding give the endpoint, the problem, and the shape you would ship in its place. Separate what must change before release from what can wait.',
  },
  {
    id: 'db-migration', name: 'Review a database migration', field: 'Ship', line: 'Locks, data loss, rollback and deploy order checked before the migration runs', pack: 'review', crew: ['claude', 'codex'], ask: 'Which migration file or change?',
    prompt: 'Review this database migration before it runs in production: {{input}}\n\nRead the migration and the code that uses the tables it touches. Check for long locks on large tables, rewrites of whole tables, columns or data dropped while old code still reads them, missing or blocking index builds, defaults and NOT NULL on existing rows, and whether old and new code both work during the deploy. Run it up and down against a local copy of the database if one is available. Say whether it is safe to run, the order to deploy code and migration in, and how to roll back.',
    tools: ['postgres', 'sqlite'],
  },
  {
    id: 'release', name: 'Write release notes from git log', field: 'Ship', line: 'Commits since a tag or date, grouped as New, Improved and Fixed for users', pack: 'writing', ask: 'Since which tag or date?',
    prompt: 'Write release notes for the changes since {{input}}. Read the commits and merged pull requests (`git log`, and `gh pr list --state merged` if available). Group them into New, Improved and Fixed, and write each line for someone who uses the product and has not seen the code. Leave out refactors and internal work. Lead with the one change people will care about most, and list breaking changes with what to do about them.',
  },
  {
    id: 'docs', name: 'Write the README', field: 'Ship', line: 'What the project is and how to install and run it, with each command checked', pack: 'writing',
    prompt: 'Write or rewrite the README for this project. Open with one sentence on what it is and who it is for, then install and run steps (run them to check they work), the main concepts, configuration, and how to contribute. Keep it to what a new user needs.',
  },
  {
    id: 'module-docs', name: 'Document a module', field: 'Ship', line: 'Reference docs for one module, written from its code, with examples that run', pack: 'writing', crew: ['claude', 'antigravity'], ask: 'Which module or folder?',
    prompt: 'Write documentation for {{input}}.\n\nRead the module and its tests in full. Write what it is for in two sentences, how it fits with the code around it, its public functions or endpoints with parameters, return values and errors, and three examples of common use. Run each example to check it works. Note behaviour that would surprise a caller. Put the docs where this project keeps them, or next to the module as a README if it has no docs folder.',
  },
  {
    id: 'deploy', name: 'Set up CI and deploys', field: 'Ship', line: 'A CI workflow, preview deploys for pull requests and production from main', pack: 'software', ask: 'Where should it run?',
    prompt: 'Set up deployment to {{input}} for this project: a CI workflow that runs the checks on each push, preview deploys for pull requests if the host supports them, and production deploys from the main branch. Keep secrets out of the repo and list the ones I need to add.',
  },
  // Design
  {
    id: 'landing', name: 'Design and build a landing page', field: 'Design', line: 'Three directions in a line each, then the strongest built with real copy', pack: 'design', ask: 'What is the product?',
    prompt: 'Design a landing page for {{input}}.\n\nPropose three distinct directions in one line each and pick the strongest. Build it with real copy, one clear call to action, a strong first screen and a layout that works on a phone. Check it in the Lunchbox browser at desktop and phone width and screenshot both.',
    tools: ['shadcn', 'magic'],
  },
  {
    id: 'polish', name: 'Polish an existing UI', field: 'Design', line: 'The ten most visible spacing, hierarchy and state problems fixed, with screenshots', pack: 'design',
    prompt: 'Open the app in the Lunchbox browser and review the interface like a senior product designer: hierarchy, spacing rhythm, alignment, contrast, empty and loading states, focus states and motion. Screenshot it, fix the ten most noticeable issues in code, then screenshot it again.',
  },
  {
    id: 'figma', name: 'Build a Figma frame in code', field: 'Design', line: 'A Figma link turned into components in this project\'s stack, compared with the design', pack: 'design', ask: 'Paste the Figma link',
    prompt: 'Build this Figma design in the project\'s stack: {{input}}\n\nRead the frame\'s layout, tokens and assets with the Figma tools, reuse existing components where they match, and match its spacing and type. Compare a screenshot of the result with the design and fix the differences.',
    tools: ['figma'],
  },
  {
    id: 'a11y', name: 'Accessibility check', field: 'Design', line: 'Keyboard use, contrast, labels and headings checked in the browser and fixed in code', pack: 'design',
    prompt: 'Check this app for accessibility in the Lunchbox browser and in code. Walk each main page with the keyboard alone: focus order, visible focus, traps, and controls that only a mouse can reach. Check text contrast against WCAG AA, labels on inputs and buttons, alt text, heading order, landmarks, and whether motion respects the reduced motion setting. Fix the issues in code, list each fix with its page, and list anything that needs a design decision.',
    tools: ['playwright'],
  },
  {
    id: 'icon', name: 'Make an app icon', field: 'Design', line: 'Three icon concepts generated at 1024 px for you to choose from', pack: 'design', ask: 'What is the app?',
    prompt: 'Make an app icon for {{input}}. Write three distinct concepts in a line each, then generate each with make_image at 1024x1024 and save them in icons/. Simple shapes that read at 32 px, no text.',
  },
  // Research
  {
    id: 'deep', name: 'Research a question with sources', field: 'Research', line: 'A short answer, the evidence with links, and what is still uncertain', pack: 'research', crew: ['claude', 'grok', 'antigravity'], ask: 'What do you want to know?',
    prompt: 'Research: {{input}}\n\nSplit it into the three to five questions that decide the answer. Search the web and X for each, prefer primary sources, and note where sources disagree. Write a short answer first, then the evidence with links, then what is still uncertain.',
    tools: ['exa', 'firecrawl'],
  },
  {
    id: 'compare', name: 'Compare libraries or tools', field: 'Research', line: 'The options scored in one table with sources, and a recommendation', pack: 'research', crew: ['claude', 'antigravity'], ask: 'Compare what, for what purpose?',
    prompt: 'Compare {{input}}. Choose the criteria that matter for this purpose (for libraries: maintenance, release history, open issues, size, licence, docs and how well each fits this codebase). Score each option with evidence and links, and make a clear recommendation with the conditions under which a different option wins.',
  },
  {
    id: 'sentiment', name: 'See what people say about a topic', field: 'Research', line: 'Opinions from X and the web over the last two weeks, grouped by theme with quotes', pack: 'research', crew: ['grok', 'claude'], ask: 'About what?',
    prompt: 'What are people saying about {{input}} right now? Search X and the web for the last two weeks. Group the opinions into themes with how common each is, quote the most telling posts with links, and mark which views are loud and which are common.',
  },
  {
    id: 'market', name: 'Map a market', field: 'Research', line: 'One table of the players, their prices and customers, then the gaps', pack: 'research', ask: 'Which market?',
    prompt: 'Map the market for {{input}}: the main players, what each is best at, pricing, who they serve and recent moves. Put it in one table with a source per row, then say where the gaps are.',
  },
  {
    id: 'paper', name: 'Explain a paper', field: 'Research', line: 'The problem, the idea, the key result and its weak points in plain words', pack: 'research', ask: 'Link or title',
    prompt: 'Read {{input}} and explain it: the problem, the idea in plain words, how they tested it, the key result, and the weaknesses a sceptical reviewer would raise. End with who should care and why.',
  },
  // Write
  {
    id: 'design-doc', name: 'Write a design doc', field: 'Write', line: 'The problem, the options, the design you would ship and its risks, with real file names', pack: 'writing', crew: ['claude', 'antigravity'], ask: 'What are you planning to build or change?',
    prompt: 'Write a design doc for: {{input}}\n\nRead the code this touches first. Cover the problem and why it needs solving now, goals and what is out of scope, two or three options with their costs, the design you recommend with the data model and interfaces it changes, how to roll it out and back, how to test it, and the open questions. Name real files and functions. Keep it under two pages and save it where this project keeps its docs.',
  },
  {
    id: 'post', name: 'Write a blog post', field: 'Write', line: 'A post of about 700 words built around one idea, with concrete examples', pack: 'writing', ask: 'What is it about?',
    prompt: 'Write a blog post about {{input}}. One idea, an opening line that gives the reader a reason to continue, concrete examples, and an ending that says something. Draft around 900 words, then cut 20 percent.',
  },
  {
    id: 'edit', name: 'Make a text shorter and clearer', field: 'Write', line: 'Your text tightened in your own voice, with the biggest changes explained', pack: 'writing', ask: 'Paste the text or a file path',
    prompt: 'Edit this for clarity and length while keeping my voice:\n\n{{input}}\n\nCut what adds nothing, replace vague words with exact ones, and fix the order where it confuses. Show the edited version, then a short list of the biggest changes and why.',
  },
  {
    id: 'email', name: 'Write an email that says no', field: 'Write', line: 'Decline, ask a favour or deliver bad news in a short email, in a warm and a firm version', pack: 'writing', ask: 'What do you need to say, and to whom?',
    prompt: 'Write this email: {{input}}\n\nShort, direct and kind. The point in the first two lines, the reason in one, and a clear next step. Give two versions: one warmer, one firmer.',
  },
  {
    id: 'newsletter', name: 'Write this week\'s newsletter', field: 'Write', line: 'The week\'s three biggest stories in your topic, with why each matters to your readers', pack: 'writing', crew: ['grok', 'claude'], ask: 'Topic and audience',
    prompt: 'Write this week\'s newsletter on {{input}}. Find the three most important things that happened this week on the web and X, explain why each matters for the audience, and add one opinion of our own. A subject line under 50 characters.',
  },
  // Grow
  {
    id: 'launch', name: 'Write launch posts', field: 'Grow', line: 'An X thread, Product Hunt text, a Show HN post and a LinkedIn post for one launch', pack: 'growth', crew: ['grok', 'claude'], ask: 'What are you launching?',
    prompt: 'Write the launch posts for {{input}}: an X thread of 5 to 7 posts that opens with the result, a single launch post, a Product Hunt tagline and description, a Show HN title and first comment, and a LinkedIn post. Read how the launches that did well in this niche on X this month are written, and match that register.',
  },
  {
    id: 'readme-stars', name: 'Get a GitHub repo ready to launch', field: 'Grow', line: 'A README that shows the project on its first screen, plus topics and launch post drafts', pack: 'growth',
    prompt: 'Get this repository ready for a public launch: a README that shows what the project does on its first screen (with a screenshot or GIF), a description of one line, topics, a quick start that works when pasted, and drafts of an X post and a Show HN post for launch day.',
    tools: ['github'],
  },
  {
    id: 'replies', name: 'Find posts worth replying to on X', field: 'Grow', line: 'Ten posts from the last 24 hours in your niche, each with a drafted reply', pack: 'growth', crew: ['grok', 'claude'], ask: 'Your niche',
    prompt: 'Find ten posts on X from the last 24 hours in {{input}} that are worth replying to: growing, from accounts my audience follows, where a reply can add something. Draft a reply for each that adds a fact, a story or a clear opinion. No flattery.',
  },
  {
    id: 'seo-audit', name: 'Audit a site for SEO', field: 'Grow', line: 'Technical SEO issues ranked by impact, with the ones in this folder fixed', pack: 'seo', ask: 'Which site?',
    prompt: 'Audit {{input}} for SEO. Crawl it in the Lunchbox browser or with the crawl tools: titles, descriptions, headings, canonical tags, sitemap, robots, structured data, broken links, image alt text, Core Web Vitals and internal linking. Rank by impact and fix what is in this folder.',
    tools: ['firecrawl'],
  },
  {
    id: 'keywords', name: 'Plan 20 articles for search', field: 'Grow', line: 'Twenty article ideas, each with the query it targets and why you can rank for it', pack: 'seo', ask: 'Site and topic',
    prompt: 'Build a content plan for {{input}}: twenty article ideas grouped by search intent, each with the main query, why we can rank for it, and the angle competitors miss. Order by effort against payoff.',
  },
  // Data
  {
    id: 'sql', name: 'Answer a question with SQL', field: 'Data', line: 'The schema read, a query written and run, and the result checked against a simpler count', pack: 'data', ask: 'What do you want to know?',
    prompt: 'Answer this from the database: {{input}}\n\nInspect the schema first, write the query, run it, and sanity check the result against a simpler count. Show the query, the result and one sentence on what it means.',
    tools: ['postgres', 'sqlite', 'supabase'],
  },
  {
    id: 'slow-query', name: 'Speed up a slow query', field: 'Data', line: 'The query plan read, an index or rewrite proposed, and timing before and after', pack: 'data', ask: 'Paste the query, or say where it lives',
    prompt: 'Speed up this query: {{input}}\n\nRun it with EXPLAIN ANALYZE (or this database\'s equivalent) against realistic data and record the time. Read the plan for full scans, bad row estimates, sorts that spill to disk and repeated lookups from the application. Propose the smallest change that fixes the biggest cost: an index, a rewrite, or fewer round trips. Apply it locally, measure again, and check the result set is the same. Write the index as a migration and say what it costs on writes.',
    tools: ['postgres', 'sqlite', 'supabase'],
  },
  {
    id: 'explore', name: 'Explore a dataset', field: 'Data', line: 'Its shape, missing and odd values, and the five strongest patterns with a chart each', pack: 'data', ask: 'Which file or table?',
    prompt: 'Explore {{input}}. Load it with code, report its shape, types, missing and odd values, then the five most interesting patterns with a chart each saved as PNG. Show the code behind each number.',
  },
  {
    id: 'dashboard', name: 'Build a dashboard', field: 'Data', line: 'Five numbers with their trends, on a page that starts locally with one command', pack: 'data', ask: 'For which data and audience?',
    prompt: 'Build a small dashboard for {{input}}: pick the five numbers that matter for this audience, show each with its trend, and make it run locally with one command. Check it in the Lunchbox browser and screenshot it.',
  },
  {
    id: 'clean', name: 'Clean a spreadsheet', field: 'Data', line: 'Types and formats made consistent, duplicates removed and logged, original file kept', pack: 'data', ask: 'Which file?',
    prompt: 'Clean {{input}}: consistent types and formats, trimmed text, duplicates removed with a log of what was removed, and obvious errors flagged for me to decide on. Save a cleaned copy next to the original and leave the original file as it is.',
  },
  // Security
  {
    id: 'audit', name: 'Security review of a codebase', field: 'Security', line: 'Findings with file, line, how each could be exploited and the fix, worst first', pack: 'security', crew: ['claude', 'codex'],
    prompt: 'Review this codebase for security issues: injection, auth and access control, secrets, unsafe deserialisation, SSRF, path traversal, dependency vulnerabilities and insecure defaults. For each finding give file and line, how it could be exploited, severity, and the fix. Fix the critical ones, each with a test that fails before the fix.',
  },
  {
    id: 'deps-audit', name: 'Audit dependencies', field: 'Security', line: 'Known vulnerabilities, abandoned packages and licence problems, safe upgrades applied', pack: 'security', crew: ['codex', 'claude'],
    prompt: 'Audit this project\'s dependencies. Run the package manager\'s audit (npm audit, pip-audit, cargo audit, govulncheck or the equivalent) and list each known vulnerability with its severity and whether this code reaches the affected part. Flag packages with no release in two years, packages with one maintainer that sit deep in the tree, and licences that conflict with this project\'s own. Apply the upgrades that stay inside the current major version, run the tests, and list the rest with what each would take.',
  },
  {
    id: 'secrets', name: 'Find leaked secrets', field: 'Security', line: 'API keys, tokens and passwords in the code and the git history, and which to rotate', pack: 'security',
    prompt: 'Search this repository and its full git history for leaked secrets: API keys, tokens, passwords and private keys. List each with where it was found and whether it is still in the current code. Show only the first four characters of each value. Say which ones to rotate.',
  },
  {
    id: 'headers', name: 'Harden a web app', field: 'Security', line: 'Security headers, a content security policy, cookie flags, CSRF and rate limits on login', pack: 'security',
    prompt: 'Harden this web app: security headers, a strict content security policy that the app still works under, cookie flags, CSRF protection, rate limits on auth endpoints, and error messages that reveal nothing internal. Check the result in the Lunchbox browser for console errors.',
  },
  // Learn
  {
    id: 'onboard', name: 'Map an unfamiliar codebase', field: 'Learn', line: 'What the repo does, its main parts, how data flows and where to start reading', pack: 'learn', crew: ['claude', 'antigravity'],
    prompt: 'Map this codebase for someone who starts on it today. Read the README, the entry points, the dependency files and the largest modules. Write what it does in two sentences, the main parts and how data flows between them, an ASCII diagram of the architecture, how to run it and its tests, where to start reading for the three most common kinds of change, and the five things that would surprise a newcomer. Name real files. Change nothing.',
  },
  {
    id: 'trace', name: 'Explain how a piece of code works', field: 'Learn', line: 'One function or feature traced through the code, with the files in reading order', pack: 'learn', ask: 'Which function, file or feature?',
    prompt: 'Explain how this works: {{input}}\n\nTrace it from where it starts (a route, a click, a command) to where it ends. List the files and functions in the order they run, with one line on what each does and what data it passes on. Point out the parts that are easy to misread and why they are written that way; use git blame and the commit messages where they help. Change nothing.',
  },
  {
    id: 'teach', name: 'Teach me a topic', field: 'Learn', line: 'One idea at a time, each with an example and a question to check you got it', pack: 'learn', ask: 'What do you want to learn?',
    prompt: 'Teach me {{input}}. Ask what I already know first. Then one idea at a time, each with a concrete example, and a short question to check I got it before moving on.',
  },
  {
    id: 'interview', name: 'Practise a job interview', field: 'Learn', line: 'Questions for a role you name, one at a time, with feedback on each answer', pack: 'learn', ask: 'Which role?',
    prompt: 'Run a mock interview for {{input}}. Ask one question at a time like a real interviewer, wait for my answer, then give honest feedback and a stronger example answer before the next question.',
  },
  // Run
  {
    id: 'incident', name: 'Triage an incident from logs', field: 'Run', line: 'Paste logs or name a log file and get a timeline, the likely cause and what to do now', pack: 'software', crew: ['claude', 'antigravity'], ask: 'What is happening? Paste logs or give a file path',
    prompt: 'Something is wrong in production: {{input}}\n\nRead the logs in full. Build a timeline: the first error, what came just before it, and how it spread. Match the errors to the code in this folder and to recent commits and deploys (`git log` for the last few days). Give the most likely cause with the evidence for it, the second most likely, and what would tell them apart. Say what to do now to stop the damage (roll back, turn a flag off, restart, scale) and what to fix afterwards. Change and deploy nothing unless I ask.',
  },
  {
    id: 'standup', name: 'Write my standup from git', field: 'Run', line: 'Yesterday\'s commits written up as shipped, in progress and blocked',
    prompt: 'Read the git log and diffs in this folder from the last working day and write my standup: what shipped, what is in progress, what is blocked. Plain words, no hashes.',
  },
  {
    id: 'issues', name: 'Triage GitHub issues', field: 'Run', line: 'Duplicates grouped, each issue labelled, and the five to work on next', ask: 'Which repository?',
    prompt: 'Triage the open issues in {{input}}: group duplicates, label each by type and area, flag the urgent ones with the reason, and propose the next five to work on with a reason each. Make the changes with the GitHub tools if connected.',
    tools: ['github'],
  },
  {
    id: 'meeting', name: 'Meeting notes to action items', field: 'Run', line: 'Decisions, action items with owners and dates, and the open questions', ask: 'Paste the notes or transcript',
    prompt: 'Turn these meeting notes into decisions, action items with owners and dates, and open questions:\n\n{{input}}\n\nKeep the wording of decisions exact. Flag any action without an owner.',
  },
  {
    id: 'invoice', name: 'Look up a customer in Stripe', field: 'Run', line: 'Their plan, payment history, failed charges and open invoices in five lines', ask: 'Customer email or name',
    prompt: 'Look up {{input}} in Stripe: their plan, payment history, failed payments and open invoices. Summarise the account in five lines and suggest the next step if something is wrong.',
    tools: ['stripe'],
  },
]

export const fillPlaybook = (p: Playbook, input: string) =>
  p.prompt.includes('{{input}}') ? p.prompt.replace(/\{\{input\}\}/g, input.trim() || 'what I describe next') : input.trim() ? `${p.prompt}\n\n${input.trim()}` : p.prompt
