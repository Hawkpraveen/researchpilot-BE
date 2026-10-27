import "dotenv/config";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { loadEnvironment } from "./config/env.js";
import { researchJobsService } from "./container.js";

async function startServer() {
  const environment = loadEnvironment();
  await connectDatabase(environment.MONGODB_URI);
  await researchJobsService.recoverInterruptedJobs();

  const app = createApp(environment.WEB_ORIGIN, environment.NODE_ENV !== "production");
  const server = app.listen(environment.PORT, "127.0.0.1", () => {
    console.log(`ResearchPilot BE listening on http://127.0.0.1:${environment.PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received; closing ResearchPilot BE`);
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown failed", error);
        process.exitCode = 1;
      }
      void disconnectDatabase().catch((databaseError: unknown) => {
        console.error("MongoDB disconnect failed", databaseError);
        process.exitCode = 1;
      });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

void startServer().catch((error: unknown) => {
  console.error("ResearchPilot BE startup failed", error);
  process.exitCode = 1;
});
