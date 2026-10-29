import "dotenv/config";
import { ensureConnectorIndexes } from "./repositories/connectors/connector.repository.js";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { loadEnvironment } from "./config/env.js";
import { researchJobsService } from "./container.js";
import { ensureAuthSessionIndexes } from "./models/auth/authSession.model.js";
import { ensureProviderSettingsIndexes } from "./models/settings/providerSettings.model.js";
import { ResearchUsageModel } from "./repositories/research-usage/researchUsage.repository.js";

async function startServer() {
  const environment = loadEnvironment();
  await connectDatabase(environment.MONGODB_URI);
  await ensureAuthSessionIndexes();
  await ensureProviderSettingsIndexes();
  await ResearchUsageModel.init();
  await ensureConnectorIndexes();
  const app = createApp(environment.WEB_ORIGIN);
  const server = app.listen(environment.PORT, environment.HOST);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log(`ResearchPilot BE listening on http://${environment.HOST}:${environment.PORT} (PID ${process.pid})`);
  console.log("[research] Lifecycle logging enabled; active agent requests log elapsed time every 10 seconds.");
  await researchJobsService.recoverInterruptedJobs();

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
  if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
    console.error("[research] Another backend already owns this port. Stop the old backend before restarting; requests and logs are going to that process.");
  }
  console.error("ResearchPilot BE startup failed", error);
  void disconnectDatabase();
  process.exitCode = 1;
});
