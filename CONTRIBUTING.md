# Contributing

Thanks for helping. The most useful contributions are bug reports that include font names, and pull requests that include a test.

## Setup

Node.js 20+ and [pnpm](https://pnpm.io) 10.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Tests

- No PDFs are checked in, except the synthetic examples in `examples/`, which are generated from fictional text by `node scripts/make-example.ts`. Tests build legacy-style PDFs in memory from a bundled font (Noto Naskh Arabic, SIL Open Font License, see `test/fixtures/OFL.txt`).
- Each test checks that pdf.js extracts garbage before the repair and the expected Arabic after it.
- A fix should come with a test that fails without it.

## Sample files

Never attach a private document to an issue or pull request. If a file is needed, make a one-page sample with no personal data, or share only the output of `pdffonts file.pdf`.

## Pull requests

- One change per pull request.
- `pnpm typecheck` and `pnpm test` must pass. CI runs them.
- Add a line to `CHANGELOG.md` under an `Unreleased` heading.

## Releases (maintainers)

GitHub Actions publishes releases to npm with provenance, through npm trusted publishing. No tokens are stored anywhere.

1. Set `version` in `package.json`.
2. Rename the `Unreleased` heading in `CHANGELOG.md` to that version.
3. Commit, then push a matching tag:

   ```sh
   git tag v0.3.2
   git push origin main v0.3.2
   ```

The workflow tests and builds the package, refuses a tag that does not match `package.json`, publishes to npm, and creates the GitHub release from the changelog entry. Release tags cannot be moved or deleted.
