# Security policy

## Reporting a vulnerability

Please do not open a public issue. Use [Report a vulnerability](https://github.com/velnixdev/arabic-pdf-repair/security/advisories/new) on GitHub, or email **support@genpdf.com** with the subject `arabic-pdf-repair security`, a description, and if possible a PDF or script that shows the problem. You will get an answer within 7 days.

## Supported versions

Only the latest published version gets fixes.

## Scope

This package parses untrusted PDF files. Crashes, hangs or memory blow-ups on crafted input, and any output PDF that differs from the input in more than its `/ToUnicode` maps, are in scope.

## Release integrity

Every version from 0.3.1 on is built and published by GitHub Actions from this repository, with an npm provenance statement. Check it with `npm audit signatures`.
