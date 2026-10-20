#!/usr/bin/env python3
"""Sync a README into a marked docs section and copy its local images."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


START_MARKER = "<!-- START OF BTP.MD -->"
END_MARKER = "<!-- END OF BTP.MD -->"
MARKDOWN_IMAGE = re.compile(r"(?P<prefix>!\[[^\]]*\]\()(?P<url>[^\s)]+)(?P<suffix>(?:\s+[\"'][^\"']*[\"'])?\))")
HTML_IMAGE = re.compile(r"(?P<prefix><img\b[^>]*?\bsrc\s*=\s*[\"'])(?P<url>[^\"']+)(?P<suffix>[\"'])", re.IGNORECASE)


def local_image_path(url: str, readme_dir: Path) -> Path | None:
    """Resolve a repository-local image URL, rejecting remote and escaping paths."""
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or url.startswith(("#", "/")):
        return None

    relative = PurePosixPath(unquote(parsed.path))
    if not relative.parts or ".." in relative.parts:
        raise ValueError(f"unsafe local image path in README: {url}")

    source = readme_dir.joinpath(*relative.parts).resolve()
    repository_root = readme_dir.resolve()
    if not source.is_relative_to(repository_root):
        raise ValueError(f"image path escapes the repository: {url}")
    if not source.is_file():
        raise FileNotFoundError(f"README image does not exist: {source}")
    return source


def rewrite_images(markdown: str, readme: Path, target: Path, image_dir: Path) -> tuple[str, dict[Path, Path]]:
    copies: dict[Path, Path] = {}
    relative_image_dir = Path(image_dir).relative_to(target.parent).as_posix()

    def replace(match: re.Match[str]) -> str:
        url = match.group("url")
        source = local_image_path(url, readme.parent)
        if source is None:
            return match.group(0)

        relative_source = source.relative_to(readme.parent.resolve())
        destination = image_dir / relative_source
        copies[source] = destination
        parsed = urlsplit(url)
        rewritten = f"{relative_image_dir}/{relative_source.as_posix()}"
        if parsed.query:
            rewritten += f"?{parsed.query}"
        if parsed.fragment:
            rewritten += f"#{parsed.fragment}"
        return f'{match.group("prefix")}{rewritten}{match.group("suffix")}'

    markdown = MARKDOWN_IMAGE.sub(replace, markdown)
    markdown = HTML_IMAGE.sub(replace, markdown)
    return markdown, copies


def replace_section(document: str, content: str) -> str:
    if document.count(START_MARKER) != 1 or document.count(END_MARKER) != 1:
        raise ValueError("target must contain exactly one BTP.MD start marker and end marker")

    before, remainder = document.split(START_MARKER, 1)
    _, after = remainder.split(END_MARKER, 1)
    return f"{before}{START_MARKER}\n{content.rstrip()}\n{END_MARKER}{after}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("readme", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("image_dir", type=Path)
    args = parser.parse_args()

    readme = args.readme.resolve()
    target = args.target.resolve()
    image_dir = args.image_dir.resolve()
    content, copies = rewrite_images(readme.read_text(), readme, target, image_dir)
    target.write_text(replace_section(target.read_text(), content))

    if image_dir.exists():
        shutil.rmtree(image_dir)
    for source, destination in copies.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


if __name__ == "__main__":
    main()
