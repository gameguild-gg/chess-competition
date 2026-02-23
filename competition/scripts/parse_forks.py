#!/usr/bin/env python3
"""Parse a forks JSON file and output pipe-delimited fork info.

Usage:
    parse_forks.py <forks_json_file>

Outputs one line per fork:  username|clone_url|avatar_url|html_url
"""

import json
import sys


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <forks_json_file>", file=sys.stderr)
        sys.exit(1)

    forks_file = sys.argv[1]

    with open(forks_file) as f:
        forks = json.load(f)

    for fork in forks:
        owner = fork.get("owner", {})
        login = owner.get("login", "")
        clone_url = fork.get("clone_url", "")
        avatar_url = owner.get("avatar_url", "")
        html_url = fork.get("html_url", "")
        print(f"{login}|{clone_url}|{avatar_url}|{html_url}")


if __name__ == "__main__":
    main()
