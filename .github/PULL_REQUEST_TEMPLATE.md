## Summary

<!-- Explain the problem and the smallest coherent change. -->

## Evidence

<!-- Use Closes #123 when applicable. Link official provider interfaces, fixtures, failing tests, or the owning Agent Note. -->

## Compatibility and security

- [ ] Public contract changes are documented.
- [ ] A non-trivial decision adds or updates its owning Agent Note.
- [ ] Provider capability claims have fixture, conformance, and applicable live
      evidence.
- [ ] Unknown and provider-native data remain observable through bounded,
      redacted paths.
- [ ] No prompt, file body, credential, token, cookie, environment value,
      private path, or unredacted provider traffic is included.
- [ ] Session ownership, terminal results, cancellation, and cleanup remain
      explicit where applicable.

## Verification

<!-- List exact commands and results. Explain relevant checks that were not run. -->

- [ ] `pnpm check`
- [ ] Relevant unit, fixture, conformance, and build checks
- [ ] Relevant live-runtime checks, or an explanation of why they do not apply

## Migration and breaking changes

<!-- Required when the PR title contains ! or the body uses a BREAKING CHANGE: footer. Otherwise write "None". -->

None.

## Release impact

<!-- State patch, minor, major, or no release. The Conventional Commit PR title is authoritative. -->
