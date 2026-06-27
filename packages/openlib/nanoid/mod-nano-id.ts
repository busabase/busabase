// 'server-only'
// This file doesn't support client-side due to crypto import
import crypto from "node:crypto";

/**
 * Perform modulo operation on NanoID, related to original character set
 *
 * @param nanoId
 * @param modNum
 * @example Used for SpaceId modulo, then for MongoDB collection sharding
 */
export function modNanoId(nanoId: string, modNum: number) {
  const sha256hasher = crypto.createHash("sha256");
  sha256hasher.update(nanoId);
  const hashedNanoId = sha256hasher.digest("hex");
  const num = BigInt(`0x${hashedNanoId}`);
  const res = num % BigInt(modNum);
  return res;
}
