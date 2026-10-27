import type { RequestHandler } from "express";
import type { ResearchJobsService } from "../../services/research-jobs/researchJobs.service.js";
import { createResearchJobSchema } from "../../services/research-jobs/researchJobs.validation.js";
import { getAuthenticatedUser } from "../../helpers/auth/auth.helpers.js";
import { createAppError } from "../../utils/AppError.js";

export function createResearchJobsController(service: ResearchJobsService) {
  const list: RequestHandler = async (_request, response) => {
    response.status(200).json(await service.list(getAuthenticatedUser(response).id));
  };

  const create: RequestHandler = async (request, response) => {
    const input = createResearchJobSchema.parse(request.body);
    response.status(202).json(await service.create(input, getAuthenticatedUser(response).id));
  };

  const get: RequestHandler = async (request, response) => {
    response.status(200).json(await service.get(request.params.jobId as string, getAuthenticatedUser(response).id));
  };

  const getReport: RequestHandler = async (request, response) => {
    response.status(200).json(await service.getReport(request.params.jobId as string, getAuthenticatedUser(response).id));
  };

  const cancel: RequestHandler = async (request, response) => {
    response.status(202).json(await service.cancel(request.params.jobId as string, getAuthenticatedUser(response).id));
  };

  const streamEvents: RequestHandler = async (request, response, next) => {
    const jobId = request.params.jobId as string;
    const header = request.header("last-event-id");
    const sequence = header === undefined ? 0 : Number(header);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      next(createAppError(400, "INVALID_EVENT_ID", "Last-Event-ID must be a non-negative integer."));
      return;
    }

    try {
      await service.eventsAfter(jobId, sequence, getAuthenticatedUser(response).id);
    } catch (error) {
      next(error);
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write("retry: 3000\n\n");

    let cursor = sequence;
    let closed = false;
    let polling = false;
    let lastHeartbeat = Date.now();
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      closed = true;
      if (timer) clearTimeout(timer);
    };
    response.on("close", cleanup);

    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const events = await service.eventsAfter(jobId, cursor, getAuthenticatedUser(response).id);
        for (const event of events) {
          response.write(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify({
            jobId,
            sequence: event.sequence,
            stage: event.stage,
            message: event.message,
          })}\n\n`);
          cursor = event.sequence;
          if (event.stage === "completed" || event.stage === "failed" || event.stage === "cancelled") {
            cleanup();
            response.end();
            return;
          }
        }
        if (Date.now() - lastHeartbeat >= 15000) {
          response.write(": heartbeat\n\n");
          lastHeartbeat = Date.now();
        }
      } catch (error) {
        console.error("Research event stream polling failed", { jobId, error });
        response.write("event: error\ndata: {\"code\":\"EVENT_STREAM_INTERRUPTED\"}\n\n");
        cleanup();
        response.end();
        return;
      } finally {
        polling = false;
      }
      if (!closed) timer = setTimeout(() => void poll(), 1000);
    };

    void poll();
  };

  return { list, create, get, getReport, cancel, streamEvents };
}
