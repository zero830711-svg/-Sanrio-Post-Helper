"""Import Cinnamoroll using the shared character catalog quality rules."""
import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    sys.argv.extend(["--character", "cinnamoroll"])
    runpy.run_path(str(Path(__file__).with_name("import-rakuten-character-catalog.py")), run_name="__main__")
