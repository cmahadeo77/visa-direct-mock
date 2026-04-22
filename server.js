/**
 * Visa Direct Mock Server
 * Simulates the Visa Direct OCT (Push Funds) API endpoint.
 *
 * Amount-based scenario triggers — use the cents value to force a response:
 *   $X.00 → 00  Approved
 *   $X.05 → 05  Issuer Decline (Do Not Honor)
 *   $X.14 → 14  Invalid Card Number
 *   $X.51 → 51  Insufficient Funds
 *   $X.61 → 61  Velocity / Frequency Limit Exceeded
 *   $X.63 → 63  Card Not Eligible for Visa Direct
 *   $X.91 → 91  Issuer Unavailable
 *   $X.94 → 94  Duplicate Transaction (manual trigger)
 *
 * STAN-based duplicate detection: same STAN submitted twice = automatic RC 94.
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── RESPONSE CODE REGISTRY ───────────────────────────────────────────────────

const RESPONSE_CODES = {
  '00': { description: 'Approved',                                     category: 'approved'    },
  '05': { description: 'Do Not Honor — Issuer Decline',                category: 'decline'     },
  '14': { description: 'Invalid Card Number',                          category: 'decline'     },
  '51': { description: 'Insufficient Funds',                           category: 'decline'     },
  '61': { description: 'Exceeds Withdrawal Frequency Limit',           category: 'velocity'    },
  '63': { description: 'Card Not Eligible for Visa Direct',            category: 'ineligible'  },
  '91': { description: 'Issuer or Switch Inoperative — Timeout',       category: 'timeout'     },
  '94': { description: 'Duplicate Transaction — STAN Already Seen',    category: 'duplicate'   },
};

// Amount cents → response code
const AMOUNT_TRIGGERS = { '00':'00', '05':'05', '14':'14', '51':'51', '61':'61', '63':'63', '91':'91', '94':'94' };

// ─── SESSION STATE ─────────────────────────────────────────────────────────────

const seenSTANs = new Set();
const txLog     = [];
let   txCounter = 1;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function resolveResponseCode(body) {
  // 1. Explicit _scenario override from UI
  if (body._scenario && RESPONSE_CODES[body._scenario]) return body._scenario;

  // 2. STAN-based automatic duplicate detection
  const stan = String(body.systemsTraceAuditNumber || '');
  if (stan && seenSTANs.has(stan)) return '94';

  // 3. Amount-based trigger (cents value)
  const amount = parseFloat(body.amount || '0');
  const cents  = Math.round((amount % 1) * 100).toString().padStart(2, '0');
  if (AMOUNT_TRIGGERS[cents]) return AMOUNT_TRIGGERS[cents];

  return '00'; // default: approved
}

function buildResponse(rc) {
  const base = {
    transactionIdentifier: randomDigits(15),
    actionCode:            rc,
    transmissionDateTime:  new Date().toISOString(),
    responseStatus:        'CDT',
    responseCode:          rc,
  };
  if (rc === '00') base.approvalCode = randomDigits(6);
  return base;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// POST /visadirect/fundstransfer/v1/pushfundstransactions — OCT simulation
app.post('/visadirect/fundstransfer/v1/pushfundstransactions', handler);
app.post('/api/pushfunds', handler);   // short alias for the UI

function handler(req, res) {
  const body = req.body;
  const stan = String(body.systemsTraceAuditNumber || '');
  const rc   = resolveResponseCode(body);

  // Register STAN after resolving (so the first submission succeeds)
  if (stan && rc !== '94') seenSTANs.add(stan);

  const response = buildResponse(rc);
  const rcInfo   = RESPONSE_CODES[rc] || { description: 'Unknown', category: 'unknown' };

  const entry = {
    seq:        txCounter++,
    timestamp:  new Date().toISOString(),
    amount:     body.amount || '—',
    recipient:  body.recipientPrimaryAccountNumber
                  ? `****${String(body.recipientPrimaryAccountNumber).slice(-4)}`
                  : '—',
    stan:       stan || '—',
    rc,
    description: rcInfo.description,
    category:    rcInfo.category,
    request:    { ...body, _scenario: undefined },   // strip internal field from log
    response,
  };
  txLog.unshift(entry);
  if (txLog.length > 100) txLog.pop();

  // Simulate ~200–400ms network latency
  setTimeout(() => res.json(response), 200 + Math.random() * 200);
}

// GET /api/log — last 25 transactions
app.get('/api/log', (req, res) => res.json(txLog.slice(0, 25)));

// GET /api/scenarios — scenario reference for the UI
app.get('/api/scenarios', (req, res) => {
  res.json(
    Object.entries(RESPONSE_CODES).map(([code, info]) => ({
      code,
      ...info,
      triggerCents: code,
      exampleAmount: `10.${code}`,
    }))
  );
});

// POST /api/reset — clear STAN memory and log
app.post('/api/reset', (req, res) => {
  seenSTANs.clear();
  txLog.length = 0;
  txCounter    = 1;
  res.json({ ok: true, message: 'Session reset — STAN memory and transaction log cleared.' });
});

// ─── START ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`\nVisa Direct Mock Server`);
  console.log(`→  http://localhost:${PORT}\n`);
  console.log('Amount-based triggers (cents value → RC):');
  Object.entries(AMOUNT_TRIGGERS).forEach(([cents, rc]) => {
    const info = RESPONSE_CODES[rc];
    console.log(`   $X.${cents}  →  RC ${rc}  ${info.description}`);
  });
  console.log('\nSTAN duplicate detection: resubmit any STAN to trigger RC 94 automatically.\n');
});
