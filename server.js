/**
 * Visa Direct Mock Server
 * Simulates OCT (Push Funds), AFT (Pull Funds), and paired AFT→OCT flows.
 *
 * OCT amount triggers (cents → RC):
 *   $X.00→00 Approved  $X.05→05 Decline  $X.14→14 Invalid Card
 *   $X.51→51 Insuff.   $X.61→61 Velocity $X.63→63 Not Eligible
 *   $X.91→91 Timeout   $X.94→94 Duplicate
 *
 * AFT amount triggers (cents → RC):
 *   $X.00→00 Approved  $X.05→05 Decline  $X.51→51 Insuff. Funds
 *   $X.57→57 Not Permitted  $X.62→62 Restricted  $X.78→78 No Account
 *   $X.94→94 Duplicate  $X.96→96 System Malfunction
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
  // Shared
  '00': { description: 'Approved',                                        category: 'approved'    },
  '05': { description: 'Do Not Honor — Issuer Decline',                   category: 'decline'     },
  '14': { description: 'Invalid Card Number',                             category: 'decline'     },
  '51': { description: 'Insufficient Funds',                              category: 'decline'     },
  '94': { description: 'Duplicate Transaction — STAN Already Seen',       category: 'duplicate'   },
  // OCT-specific
  '61': { description: 'Exceeds Withdrawal Frequency Limit',              category: 'velocity'    },
  '63': { description: 'Card Not Eligible for Visa Direct',               category: 'ineligible'  },
  '91': { description: 'Issuer or Switch Inoperative — Timeout',          category: 'timeout'     },
  // AFT-specific
  '57': { description: 'Transaction Not Permitted to Cardholder',         category: 'decline'     },
  '62': { description: 'Restricted Card — Wallet / Account Blocked',      category: 'restricted'  },
  '78': { description: 'No Account / Account Not Found at Issuer',        category: 'decline'     },
  '96': { description: 'System Malfunction — Retry After Delay',          category: 'timeout'     },
};

// OCT: amount cents → response code
const OCT_TRIGGERS = { '00':'00', '05':'05', '14':'14', '51':'51', '61':'61', '63':'63', '91':'91', '94':'94' };

// AFT: amount cents → response code (pull-specific set)
const AFT_TRIGGERS = { '00':'00', '05':'05', '51':'51', '57':'57', '62':'62', '78':'78', '94':'94', '96':'96' };

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

function resolveCode(body, triggerMap) {
  if (body._scenario && RESPONSE_CODES[body._scenario]) return body._scenario;
  const stan = String(body.systemsTraceAuditNumber || '');
  if (stan && seenSTANs.has(stan)) return '94';
  const cents = Math.round((parseFloat(body.amount || '0') % 1) * 100).toString().padStart(2, '0');
  return triggerMap[cents] || '00';
}

function resolveResponseCode(body) {
  return resolveCode(body, OCT_TRIGGERS);
}

function buildOCTResponse(rc) {
  const r = {
    transactionIdentifier: randomDigits(15),
    actionCode:            rc,
    transmissionDateTime:  new Date().toISOString(),
    responseStatus:        'CDT',
    responseCode:          rc,
  };
  if (rc === '00') r.approvalCode = randomDigits(6);
  return r;
}

// Keep alias for existing handler
const buildResponse = buildOCTResponse;

function buildAFTResponse(rc, amount) {
  const r = {
    transactionIdentifier: randomDigits(15),
    actionCode:            rc,
    transmissionDateTime:  new Date().toISOString(),
    responseStatus:        'CDT',
    responseCode:          rc,
  };
  if (rc === '00') {
    r.approvalCode       = randomDigits(6);
    // Simulate available balance remaining after the pull
    const pulled  = parseFloat(amount || '0');
    const buffer  = parseFloat((Math.random() * 3000 + 200).toFixed(2));
    r.availableBalance   = (buffer + pulled).toFixed(2);
    r.cardProductSubtype = ['DEBIT', 'PREPAID'][Math.floor(Math.random() * 2)];
  }
  return r;
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

// ─── AFT HANDLER ──────────────────────────────────────────────────────────────

function aftHandler(req, res) {
  const body = req.body;
  const stan = String(body.systemsTraceAuditNumber || '');
  const rc   = resolveCode(body, AFT_TRIGGERS);

  if (stan && rc !== '94') seenSTANs.add(stan);

  const response = buildAFTResponse(rc, body.amount);
  const rcInfo   = RESPONSE_CODES[rc] || { description: 'Unknown', category: 'unknown' };

  txLog.unshift({
    seq:         txCounter++,
    type:        'AFT',
    timestamp:   new Date().toISOString(),
    amount:      body.amount || '—',
    // For AFT the "source" is senderPrimaryAccountNumber
    recipient:   body.senderPrimaryAccountNumber
                   ? `****${String(body.senderPrimaryAccountNumber).slice(-4)}`
                   : '—',
    stan:        stan || '—',
    rc,
    description: rcInfo.description,
    category:    rcInfo.category,
    request:     { ...body, _scenario: undefined },
    response,
  });
  if (txLog.length > 100) txLog.pop();

  setTimeout(() => res.json(response), 200 + Math.random() * 200);
}

app.post('/visadirect/fundstransfer/v1/pullfundstransactions', aftHandler);
app.post('/api/pullfunds', aftHandler);

// ─── PAIRED AFT→OCT HANDLER ───────────────────────────────────────────────────
// Executes AFT (pull from source) then OCT (push to recipient) in sequence.
// OCT only fires if AFT returns RC 00.

app.post('/api/pairedfunds', (req, res) => {
  const body = req.body;
  const stan = String(body.systemsTraceAuditNumber || '');

  // Step 1 — AFT
  const aftRC  = resolveCode(body, AFT_TRIGGERS);
  if (stan && aftRC !== '94') seenSTANs.add(stan);
  const aftResp = buildAFTResponse(aftRC, body.amount);
  const aftInfo = RESPONSE_CODES[aftRC] || { description: 'Unknown', category: 'unknown' };

  // Step 2 — OCT (only if AFT approved)
  let octResp = null;
  if (aftRC === '00') {
    // Paired OCT always approves once source funds are confirmed
    const octStan = String((parseInt(stan) || 0) + 1);
    if (octStan) seenSTANs.add(octStan);
    octResp = buildOCTResponse('00');
  }

  const sourceLast = String(body.senderPrimaryAccountNumber || '').slice(-4);
  const destLast   = String(body.recipientPrimaryAccountNumber || '').slice(-4);

  txLog.unshift({
    seq:         txCounter++,
    type:        'AFT→OCT',
    timestamp:   new Date().toISOString(),
    amount:      body.amount || '—',
    recipient:   `****${sourceLast} → ****${destLast}`,
    stan:        stan || '—',
    rc:          aftRC === '00' ? '00/00' : aftRC,
    description: aftRC === '00' ? 'AFT Approved → OCT Approved' : `AFT Blocked: ${aftInfo.description}`,
    category:    aftInfo.category,
    request:     { ...body, _scenario: undefined },
    response:    { aft: aftResp, oct: octResp },
  });
  if (txLog.length > 100) txLog.pop();

  const delay = aftRC === '00' ? 400 + Math.random() * 300 : 200 + Math.random() * 200;
  setTimeout(() => res.json({ aft: aftResp, oct: octResp, aftApproved: aftRC === '00' }), delay);
});

// GET /api/log — last 25 transactions
app.get('/api/log', (req, res) => res.json(txLog.slice(0, 25)));

// GET /api/scenarios — scenario reference for the UI (tagged by tx type)
app.get('/api/scenarios', (req, res) => {
  res.json(
    Object.entries(RESPONSE_CODES).map(([code, info]) => ({
      code,
      ...info,
      triggerCents: code,
      exampleAmount: `10.${code}`,
      oct: code in OCT_TRIGGERS,
      aft: code in AFT_TRIGGERS,
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
  console.log('OCT triggers:  POST /api/pushfunds');
  Object.entries(OCT_TRIGGERS).forEach(([c, rc]) => console.log(`   $X.${c} → RC ${rc}  ${RESPONSE_CODES[rc].description}`));
  console.log('\nAFT triggers:  POST /api/pullfunds');
  Object.entries(AFT_TRIGGERS).forEach(([c, rc]) => console.log(`   $X.${c} → RC ${rc}  ${RESPONSE_CODES[rc].description}`));
  console.log('\nPaired flow:   POST /api/pairedfunds  (AFT pull → OCT push)');
  console.log('\nSTAN duplicate detection active across all endpoints.\n');
});
