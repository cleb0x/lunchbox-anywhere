// The one line each tool's makers publish for installing it. Agents without one link to their page.
export const INSTALL: Record<string, { cmd?: string; url: string }> = {
  claude: { cmd: 'npm install -g @anthropic-ai/claude-code', url: 'https://claude.com/claude-code' },
  codex: { cmd: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  antigravity: { cmd: navigator.platform.startsWith('Win') ? 'irm https://antigravity.google/cli/install.ps1 | iex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash', url: 'https://antigravity.google' },
  gemini: { cmd: 'npm install -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' },
  grok: { url: 'https://x.ai' },
  ollama: { url: 'https://ollama.com/download' },
  lmstudio: { url: 'https://lmstudio.ai' },
  llamacpp: { cmd: navigator.platform.startsWith('Win') ? 'winget install llama.cpp' : /Mac/.test(navigator.platform) ? 'brew install llama.cpp' : undefined, url: 'https://github.com/ggml-org/llama.cpp' },
}
