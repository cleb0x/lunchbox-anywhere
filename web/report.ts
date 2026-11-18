// Problem reports. The desktop app posts them to a small service; the browser version talks to no
// server of its own, so a report opens as a new GitHub issue for the person to look over and file.
import type { Report } from '../shared/types'
import { catchErrors, diagnostics, logError } from '../electron/report'

export { catchErrors, diagnostics, logError }

export const REPORT_REPO = 'https://github.com/noah-thing/lunchbox'

const SECRET = /\b(sk-[\w-]{12,}|sk-ant-[\w-]{12,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xai-\w{20,}|AIza[\w-]{30,}|\d{6,}:[\w-]{30,}|gsk_\w{20,}|hf_\w{20,}|xox[a-z]-[\w-]{10,}|A[KS]IA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})|(bearer\s+)[\w.-]{16,}/gi
const clean = (s: string, max: number, keys: string[]) =>
  keys.filter((k) => k.length >= 8).reduce((t, k) => t.split(k).join('[removed]'), s).replace(SECRET, (_m, _k, bearer) => `${bearer ?? ''}[removed]`).slice(0, max)

export async function send(r: Report, _dir: string, keys: string[] = []): Promise<{ ok: boolean; queued?: boolean; number?: number }> {
  const kind = (['bug', 'idea', 'question'] as const).includes(r.kind) ? r.kind : 'bug'
  const text = clean(String(r.text ?? ''), 4000, keys)
  const body = [
    text,
    r.context ? `\n**Context**\n${clean(String(r.context), 1500, keys)}` : '',
    r.diagnostics ? `\n**Diagnostics**\n\`\`\`\n${clean(String(r.diagnostics), 2500, keys)}\n\`\`\`` : '',
    '\n_Sent from the browser version of Lunchbox._',
  ].join('\n')
  const title = `[${kind}] ${text.split('\n')[0].slice(0, 80)}`
  const url = `${REPORT_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  window.open(url, "_blank", "noopener")
  return { ok: true }
}

export async function flush(_dir: string) {}
