#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "→ creating .venv (first run)"
  python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
  if [ -d prisma ]; then
    prisma generate || true
  fi
else
  source .venv/bin/activate
fi

PYTHONUNBUFFERED=1 uvicorn app.main:app --host 127.0.0.1 --port 8100 2>&1
