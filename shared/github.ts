// The person's own GitHub repositories, read with the token saved for the GitHub tool. Plain fetch,
// so the desktop app, the server and the browser version all use the same code.

export type Repo = { name: string; private: boolean; about: string; pushed: string }

export const GITHUB_TOKEN = 'tool:github:token'

const PAGES = 3

// Newest first: the repositories they own or work on, up to three hundred.
export async function listRepos(token: string | undefined): Promise<{ repos?: Repo[]; error?: 'connect' | 'token' | string }> {
  if (!token) return { error: 'connect' }
  const out: Repo[] = []
  for (let page = 1; page <= PAGES; page++) {
    let res: Response
    try {
      res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
      })
    } catch {
      return out.length ? { repos: out } : { error: 'GitHub could not be reached. Check the connection and try again.' }
    }
    if (res.status === 401) return { error: 'token' }
    if (!res.ok) return out.length ? { repos: out } : { error: `GitHub answered ${res.status}. Try again in a moment.` }
    const list = (await res.json().catch(() => [])) as { full_name?: string; private?: boolean; description?: string | null; pushed_at?: string }[]
    for (const r of Array.isArray(list) ? list : []) if (r.full_name) out.push({ name: r.full_name, private: !!r.private, about: r.description ?? '', pushed: r.pushed_at ?? '' })
    if (list.length < 100) break
  }
  return { repos: out }
}

// owner/name, and nothing else, so a value that reaches the agents cannot carry other words.
export const isRepo = (s: unknown): s is string => typeof s === 'string' && /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(s)
