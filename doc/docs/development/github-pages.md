
# GitHub Pages deployment (MkDocs Material)

This documentation is designed to be published with MkDocs + Material on GitHub Pages.

## Option A — mkdocs gh-deploy (simple)

From the repository root:

```bash
python -m venv .venv-docs
source .venv-docs/bin/activate
pip install -r doc/requirements.txt
mkdocs gh-deploy --config-file doc/mkdocs.yml
```

## Option B — GitHub Actions (recommended)

Use the official MkDocs Material action workflow.
Place a workflow in `.github/workflows/docs.yml` that:

- checks out the repo
- installs `doc/requirements.txt`
- runs `mkdocs build -f doc/mkdocs.yml`
- publishes `site/` to GitHub Pages

> This file cannot live under `doc/` because GitHub Actions reads workflows from `.github/workflows/`.

## Common configuration

If your repository is published under a subpath (e.g. `https://ORG.github.io/s3-manager/`),
set `site_url` in `doc/mkdocs.yml` and ensure your workflow publishes accordingly.
