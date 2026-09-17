# Data Conventions

Shared rules for how domain data is stored and transmitted across both apps.

## Rules

- **Money as integer cents.** Money is stored and transmitted as integers in cents —
  never as floats. The webapp may format money for display, but always sends and receives
  integer cents via the API.
- **Dates in UTC.** All dates and timestamps are stored and transmitted as UTC.
- **Enums from the canonical source.** Use enums from the canonical source — never inline
  string literals for status, type, or mode values. The actual entity and enum
  definitions are authoritative in an RFC (e.g. `docs/rfcs/0001-article-data-model.md`);
  refer to it rather than restating enum members here.
