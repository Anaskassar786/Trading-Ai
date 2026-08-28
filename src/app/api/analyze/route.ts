// POST /api/analyze
// Accepts multipart/form-data: screenshot (file), instrumentClass, symbol,
// userTimeframe, riskAmount (optional), accountBalance (optional), desiredProfit (optional).
// Validates inputs, stores the screenshot, builds an immutable snapshot (CREATED),
// and immediately returns the session_id. The client is expected to redirect to the
// analysis page and then POST to /api/run-agents to trigger execution (so the UI can
// show real progress instead of waiting on a single synchronous POST).

import "server-only";
import { NextResponse } from "next/server";
import { parseMultipart } from "@/lib/multipart";
import { ingestScreenshot, ScreenshotError } from "@/lib/screenshot";
import { createSession } from "@/lib/orchestrator";
import type { Timeframe } from "@/lib/types";

const VALID_TF: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];
const VALID_CLASS = new Set(["GOLD", "FOREX"]);

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { fields, files } = await parseMultipart(req);

    const instrumentClass = (fields.instrumentClass || "GOLD").toUpperCase();
    const symbol = (
      fields.symbol || (instrumentClass === "GOLD" ? "XAU/USD" : "EUR/USD")
    ).trim();
    const userTimeframe = (fields.userTimeframe || "4h").toLowerCase() as Timeframe;
    const riskAmount = fields.riskAmount ? Number(fields.riskAmount) : null;
    const accountBalance = fields.accountBalance ? Number(fields.accountBalance) : null;
    const desiredProfit = fields.desiredProfit ? Number(fields.desiredProfit) : null;

    if (!VALID_CLASS.has(instrumentClass)) {
      return NextResponse.json(
        { error: "Invalid instrumentClass (must be GOLD or FOREX)" },
        { status: 400 },
      );
    }
    if (!VALID_TF.includes(userTimeframe)) {
      return NextResponse.json(
        { error: `Invalid userTimeframe (must be one of ${VALID_TF.join(",")})` },
        { status: 400 },
      );
    }
    if (riskAmount != null && (!isFinite(riskAmount) || riskAmount < 0)) {
      return NextResponse.json({ error: "Invalid riskAmount" }, { status: 400 });
    }
    if (accountBalance != null && (!isFinite(accountBalance) || accountBalance < 0)) {
      return NextResponse.json({ error: "Invalid accountBalance" }, { status: 400 });
    }
    if (desiredProfit != null && (!isFinite(desiredProfit) || desiredProfit < 0)) {
      return NextResponse.json({ error: "Invalid desiredProfit" }, { status: 400 });
    }

    let screenshot = null;
    let visionError: string | undefined;
    const file = files.find((f) => f.name === "screenshot");
    if (file) {
      try {
        const res = await ingestScreenshot(file.filename, file.contentType, file.data);
        screenshot = res.info;
        visionError = res.visionError;
      } catch (e: any) {
        if (e instanceof ScreenshotError) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }
        return NextResponse.json(
          { error: `Screenshot processing failed: ${e?.message ?? e}` },
          { status: 500 },
        );
      }
    }

    const session = await createSession({
      screenshot,
      instrument: { assetClass: instrumentClass as "GOLD" | "FOREX", symbol },
      userTimeframe,
      risk: { riskAmount, accountBalance, desiredProfit },
    });

    return NextResponse.json({
      ok: true,
      session_id: session.session_id,
      status: session.status,
      vision_warning: visionError,
      detected_timeframe: screenshot?.detectedTimeframe ?? null,
      detected_symbol: screenshot?.detectedSymbol ?? null,
      timeframe_mismatch: Boolean(
        screenshot?.detectedTimeframe && screenshot.detectedTimeframe !== userTimeframe,
      ),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
