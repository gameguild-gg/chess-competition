#!/usr/bin/env python3
"""Fetch all forks of a GitHub repo via the REST API.

Usage:
    fetch_forks.py <owner> <repo> <output_file> [--token TOKEN]

Writes a JSON array of fork objects to <output_file>.
"""

import argparse
import json
import sys
import urllib.request
import urllib.error


def fetch_all_forks(owner: str, repo: str, token: str | None) -> list[dict]:
    base_url = f"https://api.github.com/repos/{owner}/{repo}/forks"
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    all_forks: list[dict] = []
    page = 1

    while True:
        url = f"{base_url}?per_page=100&page={page}"
        print(f"Fetching page {page}: {url}", file=sys.stderr)

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            print(f"ERROR: GitHub API returned HTTP {e.code}", file=sys.stderr)
            body = e.read().decode()[:500]
            print(f"Response: {body}", file=sys.stderr)
            break

        if not isinstance(data, list) or len(data) == 0:
            break

        print(f"  Got {len(data)} forks on page {page}", file=sys.stderr)
        all_forks.extend(data)

        if len(data) < 100:
            break
        page += 1

    print(f"Found {len(all_forks)} forks total", file=sys.stderr)
    return all_forks


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch GitHub forks")
    parser.add_argument("owner", help="Repository owner")
    parser.add_argument("repo", help="Repository name")
    parser.add_argument("output", help="Output JSON file path")
    parser.add_argument("--token", default=None, help="GitHub API token")
    args = parser.parse_args()

    forks = fetch_all_forks(args.owner, args.repo, args.token)

    with open(args.output, "w") as f:
        json.dump(forks, f)


if __name__ == "__main__":
    main()
