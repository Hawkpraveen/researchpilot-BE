import type { RequestHandler } from "express";
import mongoose from "mongoose";

export function createHealthController() {
  const getHealth: RequestHandler = (_request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      service: "researchpilot-BE",
      status: connected ? "ok" : "unavailable",
      database: connected ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  };
  return { getHealth };
}
