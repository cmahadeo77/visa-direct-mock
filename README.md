# Visa Direct Mock Server

A local Node.js mock server that simulates the **Visa Direct OCT (Push Funds)** API endpoint — with a frontend UI for firing transactions and inspecting real Visa Direct request/response schemas on demand.

Built for learning, demos, and integration testing without needing Visa sandbox credentials.

---

## Why a mock server?

The real Visa sandbox just returns **approved** for everything. This mock lets you force any scenario — card not eligible, duplicate transaction, issuer timeout — on demand. You control the trigger.

---

## Quick Start

```bash
npm install
npm start
# → http://localhost:3333
```

---

## Amount-Based Scenario Triggers

Set the **cents value** of the amount to trigger a specific response code:

| Amount    | RC | Scenario                              |
|-----------|----|---------------------------------------|
| `$X.00`   | 00 | Approved                              |
| `$X.05`   | 05 | Issuer Decline — Do Not Honor         |
| `$X.14`   | 14 | Invalid Card Number                   |
| `$X.51`   | 51 | Insufficient Funds                    |
| `$X.61`   | 61 | Velocity / Frequency Limit Exceeded   |
| `$X.63`   | 63 | Card Not Eligible for Visa Direct     |
| `$X.91`   | 91 | Issuer or Switch Unavailable          |
| `$X.94`   | 94 | Duplicate Transaction (manual)        |

**STAN-based automatic duplicate detection:** submit the same STAN twice and RC 94 is returned automatically — no amount trick needed. Mirrors real Visa Direct behavior.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/visadirect/fundstransfer/v1/pushfundstransactions` | Full Visa Direct path |
| `POST` | `/api/pushfunds` | Short alias (used by UI) |
| `GET`  | `/api/log` | Last 25 transactions |
| `GET`  | `/api/scenarios` | Scenario reference |
| `POST` | `/api/reset` | Clear STAN memory + log |

---

## Request Schema (OCT)

```json
{
  "systemsTraceAuditNumber": 451001,
  "retrievalReferenceNumber": "000000451001",
  "localTransactionDateTime": "2026-04-22T20:00:00",
  "acquiringBin": "408999",
  "acquirerCountryCode": "840",
  "senderPrimaryAccountNumber": "4895142232120006",
  "senderCardExpiryDate": "2028-12",
  "senderCurrencyCode": "USD",
  "senderAddress": "123 Main St, San Francisco CA",
  "recipientPrimaryAccountNumber": "4957030420210496",
  "transactionCurrencyCode": "USD",
  "amount": "100.63",
  "businessApplicationId": "AA",
  "cardAcceptor": {
    "name": "VISA DIRECT MOCK",
    "idCode": "MOCK1234MOCK123",
    "terminalId": "MOCK1234",
    "address": { "country": "USA", "zipCode": "94404", "state": "CA" }
  }
}
```

## Response Schema (Approved)

```json
{
  "transactionIdentifier": "381228649430015",
  "actionCode": "00",
  "approvalCode": "530976",
  "transmissionDateTime": "2026-04-22T20:30:00.000Z",
  "responseStatus": "CDT",
  "responseCode": "00"
}
```

## Response Schema (Declined / Error)

```json
{
  "transactionIdentifier": "381228649430016",
  "actionCode": "63",
  "transmissionDateTime": "2026-04-22T20:30:01.000Z",
  "responseStatus": "CDT",
  "responseCode": "63"
}
```

---

## Business Application IDs

| Code | Use Case |
|------|----------|
| AA | Account to Account Transfer |
| BB | Business Disbursement |
| GD | Government Disbursement |
| PP | Person to Person |
| WT | Wallet Transfer |

---

## Key Response Codes

| RC | Meaning | Operational Note |
|----|---------|-----------------|
| 00 | Approved | Transaction complete |
| 05 | Do Not Honor | Issuer blocked — no further retry |
| 14 | Invalid Card Number | Bad PAN — check Luhn |
| 51 | Insufficient Funds | For AFT (pull) use cases |
| 61 | Velocity Limit | Too many transactions in window |
| 63 | Card Not Eligible | Recipient card not enrolled in Visa Direct |
| 91 | Issuer Unavailable | Retry once after delay |
| 94 | Duplicate Transaction | Same STAN already processed — do not retry |
