import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pack } from '../shared/types'

export const BUILTIN: Pack[] = [
  {
    id: 'software', name: 'Software', line: 'Build, fix and test code in a repo',
    brief: 'This room builds software. Read the code before changing it, keep changes small, and run the project\'s own tests or build before saying something works.',
    ideas: ['Fix the failing tests and show them passing', 'Add tests for the code that has none', 'Map this codebase and say where to start reading'],
    checks: [{ label: 'Run the tests', command: 'npm test' }, { label: 'Type check', command: 'npx tsc --noEmit' }],
  },
  {
    id: 'review', name: 'Code review', line: 'Review a diff or pull request without changing files',
    brief: 'This room reviews code. Read the diff and the code around each change, run the tests and the build, and judge whether the change does what it claims. Report each finding with the file and line, how sure you are, and a concrete fix, ordered by how much it matters. Mark each finding as blocking or optional. Leave the files as they are and post nothing to GitHub unless the person asks.',
    ideas: ['Review my uncommitted changes for bugs', 'Review the last five commits on this branch', 'Check this branch against main before I open a pull request'],
    checks: [{ label: 'Run the tests', command: 'npm test' }, { label: 'Type check', command: 'npx tsc --noEmit' }],
    crew: ['claude', 'codex'],
  },
  {
    id: 'research', name: 'Research', line: 'Answer a question with linked sources',
    brief: 'This room researches. Back each factual claim with a source: a link or a file path. Say how sure you are and what would change your mind. Prefer primary sources and recent ones.',
    ideas: ['What are people on X saying about this today', 'Compare the three best libraries for this job, with sources', 'Summarise the latest papers on a topic'],
  },
  {
    id: 'security', name: 'Security review', line: 'Find vulnerabilities, leaked secrets and risky dependencies',
    brief: 'This room reviews security. Look for injection, secrets in code or history, unsafe deserialisation, missing auth checks, weak crypto and vulnerable dependencies. Report each finding with the file and line, how it could be exploited and the smallest fix. Do not run exploits against anything outside this folder.',
    ideas: ['Review this repo for security issues, worst first', 'Check the dependencies for known vulnerabilities', 'Search the git history for leaked secrets'],
    checks: [{ label: 'npm audit', command: 'npm audit --omit=dev' }],
  },
  {
    id: 'data', name: 'Data', line: 'Analyse CSV files and databases, with charts',
    brief: 'This room works with data. Load the files with real code and compute each number. Show the query or script behind each figure, say how many rows it covers, and flag missing or odd values before drawing conclusions. Save charts as PNG files in the folder.',
    ideas: ['Explore the CSV files here and tell me what stands out', 'Chart the trend in this data and explain it', 'Find the outliers and say whether they are errors'],
    checks: [{ label: 'Python available', command: 'python3 --version' }],
  },
  {
    id: 'design', name: 'Design', line: 'Design interfaces, brand basics and images',
    brief: 'This room designs. Start from the person\'s goal and audience, propose two or three distinct directions before polishing one, and keep a short list of the decisions made. Use make_image for visuals and save them in the folder. Prefer fewer colours, clear hierarchy and real content over lorem ipsum.',
    ideas: ['Propose three directions for a landing page for this product', 'Make an app icon in three styles', 'Review this UI for hierarchy, spacing and contrast'],
  },
  {
    id: 'writing', name: 'Writing', line: 'Draft, edit and fact check text in your voice',
    brief: 'This room writes. Keep the person\'s voice. One agent drafts, another edits for clarity and cuts, and claims of fact get checked. Prefer short sentences and concrete words.',
    ideas: ['Write release notes from the commits since the last tag', 'Edit this document for clarity and length', 'Draft a launch post from the notes in this folder'],
  },
  {
    id: 'seo', name: 'SEO', line: 'Audit a site for search and fix what it finds',
    brief: 'This room works on search visibility. Check titles, meta descriptions, headings, internal links, structured data, page speed and crawlability. Back each recommendation with the page and the evidence, and rank fixes by impact.',
    ideas: ['Audit the site in this folder for SEO issues', 'Write titles and meta descriptions for each page', 'Find keywords competitors rank for and we do not'],
    checks: [{ label: 'Lighthouse', command: 'npx --yes @lhci/cli autorun --collect.staticDistDir=.' }],
  },
  {
    id: 'growth', name: 'Growth', line: 'Write launch posts and follow what people say on X',
    brief: 'This room grows an audience. Use live X and web search to see what the audience talks about right now, write in the person\'s voice, and give each post a reason to exist: a hook, one idea, a clear ask. Keep drafts short and offer variants instead of one long version.',
    ideas: ['What is my niche on X talking about this week', 'Write five launch posts for the project in this folder', 'Find ten accounts worth replying to today and draft replies'],
    crew: ['grok', 'claude'],
  },
  {
    id: 'workshop', name: 'Workshop', line: 'Change Lunchbox itself', hidden: true,
    brief: 'This room changes Lunchbox itself: the folder is the person\'s own copy of its source, and what you build runs only on their computer. Read WORKSHOP.md in this folder before anything else and follow it. Build what they asked so it looks and behaves like the rest of the app, keep the change as small as it can be, and run npm run typecheck, npm test and npm run build before saying it works. Then tell them to press Try it in the room\'s header to use it.',
    ideas: ['A button that copies the whole room as Markdown', 'A shortcut that opens the room\'s folder in my editor', 'A page that lists my open pull requests'],
    checks: [{ label: 'Type check', command: 'npm run typecheck' }, { label: 'Tests', command: 'npm test' }, { label: 'Build', command: 'npm run build' }],
  },
  {
    id: 'learn', name: 'Learning', line: 'Learn a topic or a codebase one idea at a time',
    brief: 'This room teaches. Find out what the person already knows, explain one idea at a time with a concrete example, and check understanding with a short question before moving on. Link to good sources for going deeper.',
    ideas: ['Teach me how this codebase is put together', 'Explain a topic from scratch with examples', 'Quiz me on what we covered last time'],
  },
]

const valid = (p: Partial<Pack>): p is Pack =>
  typeof p.id === 'string' && /^[a-z0-9-]{2,40}$/.test(p.id) && typeof p.name === 'string' && typeof p.brief === 'string' && Array.isArray(p.ideas)

export function loadPacks(files: string[]): Pack[] {
  const user: Pack[] = []
  for (const file of files) {
    try {
      const p = JSON.parse(readFileSync(file, 'utf8'))
      if (valid(p)) user.push({ ...p, line: p.line ?? '', ideas: p.ideas.slice(0, 6), source: 'user' })
    } catch {}
  }
  const ids = new Set(user.map((p) => p.id))
  return [...BUILTIN.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, source: 'builtin' as const })), ...user]
}

const NOT_A_PACK = 'That is not a Lunchbox pack. It needs an id, a name, a brief and a list of ideas.'

export function importPack(file: string, dir: string): Pack {
  const p = JSON.parse(readFileSync(file, 'utf8'))
  if (!valid(p)) throw new Error(NOT_A_PACK)
  const clean = shaped(p)
  writeFileSync(join(dir, `${clean.id}.json`), JSON.stringify(clean, null, 2))
  return { ...clean, source: 'user' }
}

// A pack from outside, cut down to the fields a pack has, each held to its type and length.
const shaped = (p: Pack): Pack => ({
  id: p.id, name: p.name.slice(0, 40), line: (typeof p.line === 'string' ? p.line : '').slice(0, 80), brief: p.brief.slice(0, 4000),
  ideas: p.ideas.filter((i) => typeof i === 'string').slice(0, 6),
  crew: Array.isArray(p.crew) ? p.crew.filter((w) => typeof w === 'string').slice(0, 8) : undefined,
  checks: Array.isArray(p.checks) ? p.checks.filter((c) => c && typeof c.command === 'string' && typeof c.label === 'string').map((c) => ({ label: c.label.slice(0, 60), command: c.command.slice(0, 400) })).slice(0, 6) : undefined,
})

// Packs are shared as plain links: a gist, a raw GitHub file, any https URL that returns the JSON.
export async function fetchPack(url: string, dir: string): Promise<Pack> {
  let u: URL
  try { u = new URL(url.trim()) } catch { throw new Error('That does not look like a link') }
  if (u.protocol !== 'https:') throw new Error('Only https links are accepted')
  if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) u = new URL(`https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}`)
  if (u.hostname === 'gist.github.com' && !u.pathname.endsWith('/raw')) u = new URL(`https://gist.githubusercontent.com${u.pathname}/raw`)
  const res = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json, text/plain' } })
  if (!res.ok) throw new Error(`The link answered ${res.status}`)
  const text = await res.text()
  if (text.length > 200_000) throw new Error('That file is too large to be a pack')
  let p: Partial<Pack>
  try { p = JSON.parse(text) } catch { throw new Error(NOT_A_PACK) }
  if (!valid(p)) throw new Error(NOT_A_PACK)
  const clean = shaped(p)
  writeFileSync(join(dir, `${clean.id}.json`), JSON.stringify(clean, null, 2))
  return { ...clean, source: 'user' }
}

export function removePack(id: string, dir: string) {
  if (!/^[a-z0-9-]{2,40}$/.test(String(id))) return
  rmSync(join(dir, `${id}.json`), { force: true })
}

export function packJson(p: Pack) {
  const { source: _, ...rest } = p
  return JSON.stringify(rest, null, 2) + '\n'
}
