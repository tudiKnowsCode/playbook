import { NextResponse } from "next/server";
import { invalidate } from "@/lib/cache";

/** Drops every cached upstream response so the next render refetches. */
export async function POST() {
  invalidate();
  return NextResponse.json({ ok: true, at: Date.now() });
}
