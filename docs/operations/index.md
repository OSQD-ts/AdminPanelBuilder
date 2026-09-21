# Operations

Running a panel in production.

← [Documentation](../index.md)

---

| | |
| --- | --- |
| [Security](security.md) | Authentication, controls, the page's own defences, and where not to mount a panel. |
| [Themes](themes.md) | Material, Apple, OSQD, and your own. |
| [Persistence](persistence.md) | Remembering an operator's choices across restarts. |
| [Configuration](configuration.md) | Listener settings from a TOML file and the environment. |
| [Several processes](replicas.md) | Replicas that share settings, the change log and chart history. |
| [Changes and notices](changes-and-notices.md) | Who changed what, undo, approvals, timed changes, and notices. |
| [Audit](audit.md) | Keeping every change, and sending it to logs, webhooks and notifiers. |
| [Metrics](metrics.md) | The panel's numbers in Prometheus. |

**One panel reports one process.** A panel shows the values of the process it runs in. Behind a load
balancer with four replicas there are four panels, and an edit changes one replica; give each listener
an `instance` name so the header says which, and use a [remote panel](../integration/remote.md) to show a
process that does not face operators.
