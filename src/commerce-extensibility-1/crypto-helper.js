import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Same helper as commerce-backend-ui-2/actions/crypto-helper.js, duplicated here since the two
// extensions build separately. Encrypts small secrets before they go into State.
// Format on disk: iv:authTag:data, all hex. Key must be a 32-byte hex string.
const ALGORITHM = "aes-256-gcm";

export function encrypt(text, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decrypt(payload, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
