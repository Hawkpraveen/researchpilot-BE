"""Run the private agent and public API; stop the container if either exits."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


def main():
    root = Path(__file__).resolve().parent.parent
    children = []
    stopping = False

    def stop(signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        agent_env = {**os.environ, "HOST": "127.0.0.1", "PORT": "8000"}
        agent = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
             "--port", "8000", "--workers", "1", "--no-access-log"],
            cwd=root / "agent", env=agent_env,
        )
        children.append(agent)
        deadline = time.monotonic() + 60
        while not stopping:
            if agent.poll() is not None:
                raise RuntimeError("Agent exited before becoming ready.")
            try:
                with urlopen("http://127.0.0.1:8000/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("Agent did not become ready within 60 seconds.")
            time.sleep(0.2)
        if stopping:
            return 0
        # Local URL is intentional: this container always owns the agent process.
        api_env = {**os.environ, "AGENT_BASE_URL": "http://127.0.0.1:8000"}
        children.append(subprocess.Popen(["node", "dist/server.js"], cwd=root, env=api_env))
        while not stopping:
            for child in children:
                if child.poll() is not None:
                    raise RuntimeError(f"Service process {child.pid} exited ({child.returncode}).")
            time.sleep(0.2)
        return 0
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 10
        for child in children:
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Container startup/runtime failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
