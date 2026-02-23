#!/usr/bin/env python3
"""Manage the competition manifest.json file.

Usage:
    manifest.py add <manifest_file> <username> <avatar_url> <fork_url>
    manifest.py format <manifest_file> <output_file>
"""

import json
import sys


def add_entry(manifest_file: str, username: str, avatar: str, fork_url: str) -> None:
    """Append a bot entry to the manifest."""
    with open(manifest_file) as f:
        manifest = json.load(f)

    manifest.append({
        "username": username,
        "avatar": avatar,
        "forkUrl": fork_url,
    })

    with open(manifest_file, "w") as f:
        json.dump(manifest, f)


def format_manifest(manifest_file: str, output_file: str) -> None:
    """Pretty-print the manifest to the output file."""
    with open(manifest_file) as f:
        manifest = json.load(f)

    with open(output_file, "w") as f:
        json.dump(manifest, f, indent=2)


def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <command> <args...>", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]

    if command == "add":
        if len(sys.argv) != 6:
            print(f"Usage: {sys.argv[0]} add <manifest_file> <username> <avatar_url> <fork_url>",
                  file=sys.stderr)
            sys.exit(1)
        add_entry(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])

    elif command == "format":
        if len(sys.argv) != 4:
            print(f"Usage: {sys.argv[0]} format <manifest_file> <output_file>",
                  file=sys.stderr)
            sys.exit(1)
        format_manifest(sys.argv[2], sys.argv[3])

    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
