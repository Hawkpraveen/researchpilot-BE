import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/helpers/auth/password.helpers.js";
import { loginSchema, registerSchema } from "../src/controllers/auth/auth.validation.js";

const validRegistration = {
  first_name: "Research",
  last_name: "User",
  email: "  user@example.com ",
  password: "correct horse battery staple",
};

test("password helper hashes securely and verifies matching credentials", async () => {
  const hash = await hashPassword(validRegistration.password);

  assert.match(hash, /^scrypt\$/);
  assert.notEqual(hash, validRegistration.password);
  assert.equal(await verifyPassword(validRegistration.password, hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.equal(await verifyPassword("password", "invalid-hash"), false);
});

test("auth request validation normalizes supported inputs and rejects invalid fields", () => {
  const registration = registerSchema.parse(validRegistration);
  assert.equal(registration.email, "user@example.com");
  assert.equal(registerSchema.safeParse({ ...validRegistration, password: "short" }).success, false);
  assert.equal(registerSchema.safeParse({ ...validRegistration, isAdmin: true }).success, false);
  assert.equal(registerSchema.safeParse({ ...validRegistration, email: "not-an-email" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "user@example.com", password: "" }).success, false);
});
