import cors from "cors";
import express from "express";
import helmet from "helmet";
import { researchJobsService } from "./container.js";
import { apiErrorHandler } from "./middleware/apiErrorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { createApiRoutes } from "./routes/index.js";

export function createApp(webOrigin: string, allowDemoAuth = false) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(requestId);
  app.use(cors({
    origin: [webOrigin, "http://localhost:8080", "http://127.0.0.1:8080"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Last-Event-ID", "X-Request-ID"],
  }));
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use("/api/v1", createApiRoutes({
    researchJobsService,
    allowDemoAuth,
  }));
  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "The requested endpoint does not exist.",
        retryable: false,
        requestId: response.locals.requestId,
      },
    });
  });
  app.use(apiErrorHandler);

  return app;
}
