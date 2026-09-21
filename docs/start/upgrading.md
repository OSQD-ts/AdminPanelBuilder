# Upgrading

The part of the changelog that asks something of you.

← [Documentation](../index.md)

---

This is the first release, so there is nothing to upgrade from yet. When a release renames or removes
something, this page will carry a Was/Now/Notes table for it, a section per breaking change saying
exactly what does and does not need work, and a list of behaviour changes that can surprise you, each
naming the option that restores the old behaviour.

## What semver means here

A new option, chart kind, theme or route is a minor release. A change to what a declaration accepts, to a
wire shape in [data shapes](../reference/data-shapes.md), or to what a listener allows by default is a
major release, because each of those can change what an existing panel shows or permits. Not yet stable:
the look of the page, which may change in any release, and the `@internal` members of the handle.

## Related

- [CHANGELOG](../../CHANGELOG.md) — everything that changed.
