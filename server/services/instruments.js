// services/instruments.js — instrument specifications for position sizing.
// Position size is only computed when every required input actually exists.

export const INSTRUMENTS = {
  'XAU/USD': { type: 'metal', contract_size: 100, quote_currency: 'USD', unit: 'oz', lot_label: '1 lot = 100 oz', pip: 0.1 },
  'XAG/USD': { type: 'metal', contract_size: 5000, quote_currency: 'USD', unit: 'oz', lot_label: '1 lot = 5,000 oz', pip: 0.01 },
  'EUR/USD': { type: 'forex', contract_size: 100000, quote_currency: 'USD', unit: 'EUR', lot_label: '1 lot = 100,000 EUR', pip: 0.0001 },
  'GBP/USD': { type: 'forex', contract_size: 100000, quote_currency: 'USD', unit: 'GBP', lot_label: '1 lot = 100,000 GBP', pip: 0.0001 },
  'AUD/USD': { type: 'forex', contract_size: 100000, quote_currency: 'USD', unit: 'AUD', lot_label: '1 lot = 100,000 AUD', pip: 0.0001 },
  'NZD/USD': { type: 'forex', contract_size: 100000, quote_currency: 'USD', unit: 'NZD', lot_label: '1 lot = 100,000 NZD', pip: 0.0001 },
  'USD/JPY': { type: 'forex', contract_size: 100000, quote_currency: 'JPY', unit: 'USD', lot_label: '1 lot = 100,000 USD', pip: 0.01 },
  'USD/CHF': { type: 'forex', contract_size: 100000, quote_currency: 'CHF', unit: 'USD', lot_label: '1 lot = 100,000 USD', pip: 0.0001 },
  'USD/CAD': { type: 'forex', contract_size: 100000, quote_currency: 'CAD', unit: 'USD', lot_label: '1 lot = 100,000 USD', pip: 0.0001 },
};

/**
 * Compute position size from risk amount + entry + stop.
 * Honest about currency: if the quote currency is not USD, we need the live
 * conversion rate from the frozen snapshot; if missing → position size unavailable.
 *
 * riskAmount is treated as being in USD-equivalent account currency.
 * Returns { available, lots?, units?, risk_per_lot?, reason?, warnings[] }
 */
export function computePositionSize({ symbol, entry, stopLoss, riskAmount, snapshotLatestClose }) {
  const warnings = [];
  const spec = INSTRUMENTS[symbol];
  if (!spec) return { available: false, reason: `Position size unavailable: no instrument specification for ${symbol}.`, warnings };
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(riskAmount) || riskAmount <= 0) {
    return { available: false, reason: 'Position size unavailable: entry, stop loss, and risk amount are all required.', warnings };
  }
  const stopDistance = Math.abs(entry - stopLoss);
  if (stopDistance <= 0) return { available: false, reason: 'Position size unavailable: stop distance is zero.', warnings };

  // Loss per 1 lot in QUOTE currency = stopDistance * contract_size.
  let lossPerLotQuote = stopDistance * spec.contract_size;
  let lossPerLotUSD;

  if (spec.quote_currency === 'USD') {
    lossPerLotUSD = lossPerLotQuote;
  } else {
    // Need USD/<quote> conversion. For USD/JPY, USD/CHF, USD/CAD the pair's own
    // price IS the conversion rate (1 USD = price units of quote currency).
    if (symbol.startsWith('USD/') && Number.isFinite(snapshotLatestClose) && snapshotLatestClose > 0) {
      lossPerLotUSD = lossPerLotQuote / snapshotLatestClose;
      warnings.push(`Quote currency is ${spec.quote_currency}; converted to USD using the frozen snapshot rate ${snapshotLatestClose}.`);
    } else {
      return { available: false, reason: `Position size unavailable: quote currency is ${spec.quote_currency} and no conversion rate is present in the frozen market snapshot.`, warnings };
    }
  }

  const lots = riskAmount / lossPerLotUSD;
  warnings.push('Risk amount is assumed to be denominated in USD (or USD-equivalent). Verify your account currency with your broker; contract sizes vary by broker.');
  return {
    available: true,
    lots: Math.floor(lots * 100) / 100, // round DOWN to 0.01 lot so risk is never silently increased
    units: Math.floor(lots * spec.contract_size),
    risk_per_lot_usd: Math.round(lossPerLotUSD * 100) / 100,
    stop_distance: stopDistance,
    spec: { contract_size: spec.contract_size, lot_label: spec.lot_label, quote_currency: spec.quote_currency, pip: spec.pip },
    warnings,
  };
}
