#!/bin/sh
# Sets up YapCut in this folder: checks programs, npm packages, the word-timing Python env, then `yapcut doctor`. Safe to rerun.
set -eu
cd "$(dirname "$0")/.."

[ "$(uname -s)" = Darwin ] || { echo "YapCut needs a Mac: face boxes and cut-outs use Apple Vision."; exit 1; }
missing=""
for bin in node npm swiftc uv; do command -v "$bin" >/dev/null 2>&1 || missing="$missing $bin"; done
ff=""; for c in /opt/homebrew/opt/ffmpeg@7/bin/ffmpeg /usr/local/opt/ffmpeg@7/bin/ffmpeg; do [ -x "$c" ] && ff="$c" && break; done
[ -n "$ff" ] || missing="$missing ffmpeg@7"
[ -d "/Applications/Google Chrome.app" ] || [ -n "${YAPCUT_CHROME:-}" ] || missing="$missing Google-Chrome"
if [ -n "$missing" ]; then
  echo "MISSING:$missing"
  echo "  brew install node uv ffmpeg@7      (ffmpeg@7 has the caption renderer the default ffmpeg lacks)"
  echo "  xcode-select --install             (swiftc)"
  echo "  Google Chrome from google.com/chrome, or set YAPCUT_CHROME to another Chromium"
  exit 1
fi
if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "MISSING: an AI CLI: install Claude Code (claude) or Codex (codex, sign in with your ChatGPT plan)."
  exit 1
fi

npm install --no-audit --no-fund --silent
[ -x .venv/bin/python ] || uv venv --quiet --python 3.12 .venv
uv pip install --quiet --python .venv/bin/python qwen-asr==0.0.6 torch==2.15.0 soundfile==0.14.0 transformers==4.57.6
mkdir -p "$HOME/.local/bin"
ln -sf "$(pwd)/bin/yapcut.mjs" "$HOME/.local/bin/yapcut"
node bin/yapcut.mjs doctor
