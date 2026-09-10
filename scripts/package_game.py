"""Package only the public build output for drag-and-drop GitHub Pages upload."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
public = root / "docs"
assert (public / "index.html").is_file(), "Run npm run build first"
target = root / "typedoku-github-pages.zip"
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for file in sorted(public.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(public).as_posix())
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert "index.html" in archive.namelist()
    assert "sudoku.html" in archive.namelist()
    assert ".nojekyll" in archive.namelist()
    assert not any(name.startswith(("data/", "node_modules/", ".tools/")) for name in archive.namelist())
print(f"{target.name}: {target.stat().st_size:,} bytes")
