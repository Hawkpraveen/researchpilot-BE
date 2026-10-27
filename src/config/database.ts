import mongoose from "mongoose";

export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  console.log("MongoDB connected");
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
