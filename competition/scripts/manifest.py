#!/usr/bin/env python3
"""Manage the competition manifest.json file.

Usage:
    manifest.py add <manifest_file> <username> <avatar_url> <fork_url>
    manifest.py format <manifest_file> <output_file>
"""

import json
import sys


def add_entry(manifest_file: str, username: str, avatar: str, fork_url: str, pushed_at: str | None = None) -> None:
    """Append a bot entry to the manifest.

    If `pushed_at` is provided it will be stored as an ISO timestamp
    on the entry; this is the last time code was pushed to the fork.
    """
    with open(manifest_file) as f:
        manifest = json.load(f)

    entry = {
        "username": username,
        "avatar": avatar,
        "forkUrl": fork_url,
    }
    if pushed_at:
        entry["updatedAt"] = pushed_at

    manifest.append(entry)

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
        # added optional fifth parameter for updated_at
        if len(sys.argv) not in (6, 7):
            print(f"Usage: {sys.argv[0]} add <manifest_file> <username> <avatar_url> <fork_url> [pushed_at]",
                  file=sys.stderr)
            sys.exit(1)
        pushed_at = sys.argv[6] if len(sys.argv) == 7 else None
        add_entry(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], pushed_at)

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
