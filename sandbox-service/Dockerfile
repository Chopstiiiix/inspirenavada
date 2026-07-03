# Per-user sandbox image: Cloudflare's sandbox server + the real Claude Code CLI.
#
# The base image already ships the sandbox server, Node.js, Python, and git,
# so we only layer the coding agents on top.
#
# IMPORTANT: keep this tag EXACTLY matched to the @cloudflare/sandbox version in
# package.json. A mismatch between the Worker-side SDK and the in-container
# server is the most common breakage. (The repo examples reference 0.12.4, but
# only 0.12.3 is actually published to Docker Hub — do not "upgrade" blindly.)
FROM docker.io/cloudflare/sandbox:0.12.3

# Real coding agents. Claude Code is the one wired up in Stage 1.
# Codex is installed too so `codex` is on PATH for when its (OpenAI) auth is added.
RUN npm install -g @anthropic-ai/claude-code @openai/codex || \
    npm install -g @anthropic-ai/claude-code

# Give claude/codex more headroom for long agent runs.
ENV COMMAND_TIMEOUT_MS=600000

# The sandbox server listens on 3000.
EXPOSE 3000
