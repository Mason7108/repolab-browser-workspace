import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

const input = createInterface({ input: process.stdin, output: process.stdout });
const password = await input.question("Password to hash (input may be visible): ");
input.close();
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
const iterations = 310_000;
const salt = randomBytes(18);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const base64url = (value) => value.toString("base64url");
console.log(`\nStore this value as ACCESS_PASSWORD_HASH:\npbkdf2$${iterations}$${base64url(salt)}$${base64url(hash)}`);
