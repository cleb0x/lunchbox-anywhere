// What an agent writes, as a person should read it. Terminals, chat templates and runaway local
// models leave things in a reply that were never meant to be read: colour codes, spinner frames,
// carriage return redraws, special tokens such as <|im_end|>, a stray </think>, and a line or a
// character repeated until the output limit. Every reply passes through here before it is shown,
// stored or passed to another agent. Code blocks keep their text apart from terminal codes, since
// a token or a long run of characters inside code may be the point.

const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
// Every C0 control except tab and newline, plus DEL and the C1 range.
const CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g
// Chat template and end of text tokens from Qwen, Llama, Gemma, Mistral, gpt-oss and friends.
const TOKENS = /<\|(?:im_start|im_end|im_sep|endoftext|end_of_text|begin_of_text|eot_id|eom_id|start_header_id|end_header_id|start|end|channel|message|return|call|constrain|assistant|user|system|pad|fim_[a-z]+)\|>|<\/?(?:start_of_turn|end_of_turn|bos|eos)>|\[\/?INST\]|\[\/?SYS\]/g
// A reasoning tag left behind once its partner was cut, which the person was never meant to see.
const LOOSE_THINK = /<\/?think(?:ing)?>/g
// Braille spinner frames and the block and arc glyphs terminal spinners cycle through.
const SPINNER = /[\u2800-\u28ff\u25d0-\u25d3\u25f4-\u25f7\u2596-\u259f]+/g
// The joiners stay: emoji such as a family or a flag are built with one, and Persian needs the other.
const INVISIBLE = /[\u200b\u2060\ufeff\ufffd]/g
// Mistral's sentence marks, which only ever sit at the two ends. Inside a reply <s> is HTML.
const EDGES = /^\s*<s>|<\/s>\s*$/g

// A terminal redraws a line by returning to its start; only what was written last is on screen.
const redraw = (line: string) => (line.includes('\r') ? line.split('\r').filter(Boolean).pop() ?? '' : line)

function prose(text: string) {
  // Inline code is left alone, so `<|im_end|>` written on purpose survives.
  let out = text.split(/(`[^`\n]*`)/).map((bit, i) => (i % 2 ? bit : bit.replace(TOKENS, '').replace(LOOSE_THINK, '').replace(SPINNER, '').replace(INVISIBLE, ''))).join('')
  // One character over and over, the way a model spins when it loses the thread. A Markdown rule
  // or a short run of dots stays; past 40 the run is cut to three.
  // Rules and drawn lines run long on purpose, so those get far more room.
  out = out.replace(/(\S)\1{40,}/g, (run, ch: string) => (/[-=_~\u2500-\u257f]/.test(ch) && run.length <= 400 ? run : ch.repeat(3)))
  // The same line four or more times in a row is a loop, not content, and is kept once.
  const lines = out.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length;) {
    let j = i
    while (j + 1 < lines.length && lines[j + 1] === lines[i]) j++
    const run = j - i + 1
    // One at a time: a runaway of blank lines is too long to spread into a call.
    if (lines[i].trim() && run >= 4) kept.push(lines[i])
    else for (let k = i; k <= j; k++) kept.push(lines[k])
    i = j + 1
  }
  return kept.join('\n').replace(/\n{4,}/g, '\n\n\n')
}

// What a command printed, as a terminal would have left it on screen: no colour codes, and a
// progress line that redrew itself shows only its last state. The text is otherwise untouched.
export function tidy(text: string): string {
  if (!text) return text
  return text.replace(ESCAPES, '').replace(/\r\n/g, '\n').split('\n').map(redraw).join('\n').replace(CONTROLS, '')
}

export function clean(text: string): string {
  if (!text) return text
  const base = tidy(text).replace(EDGES, '')
  // Fences alternate prose and code; an unclosed fence at the end is code still being written.
  const parts = base.split(/^([ \t]*```.*)$/m)
  let inCode = false
  return parts.map((part) => {
    if (/^[ \t]*```/.test(part)) { inCode = !inCode; return part }
    return inCode ? part : prose(part)
  }).join('')
}
