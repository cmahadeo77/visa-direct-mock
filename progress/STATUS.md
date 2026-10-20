# Status - visa-direct-mock

_Last reviewed: 2026-10-20_

Local mock of the Visa Direct OCT/AFT APIs with amount-based response-code triggers, STAN duplicate detection, and a scenario UI.

## Components

| Component | State | Notes |
|---|---|---|
| OCT (Push Funds) | Working | Amount-cent triggers for RC 00/05/14/51/61/63/91/94 |
| AFT (Pull Funds) + paired AFT->OCT | Working |  |
| STAN duplicate detection | Working | Auto RC 94 |
| Sandbox toggle UI + credentials modal | Working | Mode-aware log |
| Tests | Missing | No automated tests |

## Known gaps

- No automated tests for scenario triggers.

## Next up

See **M1 - Tests** in [ROADMAP.md](ROADMAP.md).
