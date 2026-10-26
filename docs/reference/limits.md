# Limits

Every cap, and why it is that number.

← [Documentation](../index.md)

---

Each is exported, so a configuration past one can be refused by your own checks. `tests/docs.test.ts`
checks this table against the code.

| Constant | Value | Why |
| --- | --- | --- |
| `MAX_HISTORY_POINTS` | 10000 | A history is allocated once and held for the life of the process: 10,000 samples is 160 KB. |
| `MIN_SAMPLE_INTERVAL_MS` | 250 | Four samples a second is finer than a page polling once a second can show. |
| `MIN_POLL_INTERVAL_MS` | 250 | A page asking more often learns nothing a person can see, and costs a request each time. |
| `MAX_SERIES` | 8 | One per chart colour slot. |
| `MAX_CHANGES` | 200 | A recent-history panel, not an audit log; forward `change` events for that. |
| `MAX_NOTICES` | 100 | The same condition updates its notice rather than adding one, so 100 distinct ones is plenty. |
| `MAX_WIRE_BYTES` | 65536 | Past it a value is sent as a note rather than a poll carrying a megabyte to every viewer. |
| `DEFAULT_MAX_LENGTH` | 10000 | A page of text: far below anything that would trouble a request, a store or a change record. |
| `MAX_BODY_BYTES` | 65536 | An edit is one value. |
| `MIN_TOKEN_LENGTH` | 16 | A shorter token can be guessed. |
| `DEFAULT_ACTION_TIMEOUT_MS` | 30000 | Long enough for a real job, short enough that a hung one is noticed. |
| `DEFAULT_PORT` | 9780 | Clear of hackerpot's 9500/9501 and bothandlerjs's 9674. |
| `MAX_PAGE_SIZE` | 200 | A screenful several times over, and a bounded response however many rows a table has. |
| `MAX_SEARCH_LENGTH` | 200 | Longer is a paste, not a search. |
| `MAX_DISABLED_REASON` | 200 | Why a row action is disabled for a row: a sentence beside a button, not a page. Longer is cut. |
| `MAX_FEED_CAPACITY` | 2000 | Entries a feed may keep; past a few thousand a feed is a log and belongs in one. |
| `MAX_ENTRY_TEXT` | 1000 | A feed line longer than this is a payload, and belongs in a table. |
| `MAX_REVERT_MS` | 604800000 | A week. A "temporary" change longer than that is a setting. |
| `MIN_IMAGE_HEIGHT` | 24 | A picture shorter than this is a speck. |
| `MAX_IMAGE_HEIGHT` | 480 | Taller than a card is a page, not a reading. |
| `MAX_ALT_LENGTH` | 200 | Alt text is a sentence, not a description of a painting. |
| `MAX_QR_VERSION` | 10 | 57 × 57 modules: larger codes stop reading reliably off a screen. |
| `MAX_QR_BYTES` | 271 | What version 10 holds at level L in byte mode; a longer string is shown as text. |
| `APPROVAL_TTL_MS` | 3600000 | An hour: a proposal nobody looked at within it should be made again, by someone who still wants it. |
| `MAX_PENDING` | 100 | Proposals waiting at once; past it the oldest lapses. |
| `MIN_SESSION_SECRET_LENGTH` | 32 | A shorter signing secret can be brute-forced offline from a single cookie. |
| `MAX_SCHEDULED` | 1000 | Changes waiting for their time at once; each holds a timer and a line in the store. |
| `MAX_SCHEDULE_AHEAD_MS` | 2592000000 | Thirty days. A change planned further ahead is a decision to make again nearer the time. |
| `MAX_SYNC_MESSAGE_BYTES` | 65536 | One change between replicas; a larger message is dropped, not parsed. |
| `MAX_WEBHOOK_RETRIES` | 8 | Past it a record waits minutes behind a dead endpoint while newer ones are dropped. |
| `MAX_REVOKED_SESSIONS` | 10000 | Signed-out sessions remembered per process until they would have expired; past it the soonest to expire is forgotten. |
| `DEFAULT_WRITES_PER_MINUTE` | 60 | An operator clicking fast, not a script gone wrong. `writeLimit` changes it. |
| `MAX_FLEET_PANELS` | 100 | Each panel on a fleet page is a request on every view of it. |
| `MAX_CONFIG_LENGTH` | 262144 | A configuration file, not a data set. |
| `MAX_REASON_LENGTH` | 500 | A sentence or three: why, not a document. |
| `MIN_ROTATE_BYTES` | 65536 | A log that rotated below this would start a new file every few changes. |
| `MAX_GRID_COLUMNS` | 24 | Columns a group's grid may have; past 24 a cell is narrower than a word. |
| `MAX_CARD_ROWS` | 24 | Rows one card may take; twenty-four rows is several screens. |
| `MAX_SECTIONS_PER_GROUP` | 50 | Sections in one tab; past a few dozen, the tab is several tabs. |
| `MAX_LIST_CARD_VALUES` | 100 | Rows in one list card; past that a card is a page, and sections or a table read better. |
| `MAX_LAYOUT_MARKS_PER_GROUP` | 200 | Dividers, spacers and breaks in one tab: a bound on a page somebody has to read. |
| `MAX_LAYOUT_BYTES` | 49152 | A layout saved for everybody: a thousand cards with sizes, and still one message between replicas. |
| `MAX_LAYOUT_ENTRIES` | 5000 | Groups and cards a saved layout may name; the rest is dropped, not stored. |

## Related

- [Charts](../concepts/charts.md) — what a history costs.
