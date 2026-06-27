import { customAlphabet } from "nanoid";

/**
 * Default character set for NanoID
 */
export const defaultNanoIdAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Length of the default NanoId character set
 *
 * @returns
 */
export function defaultNanoIdAlphabetCount() {
  return defaultNanoIdAlphabet.length;
}

/**
 * Generate a random nano id
 *
 * Note: Frontend and client should not use generateNanoID. Use APICaller.generateRandomString for generating random strings instead.
 *
 * @param prefix nano prefix
 * @param length nano length
 */
export function generateNanoID(
  prefix: string = "",
  length: number = 21,
  alphabet = defaultNanoIdAlphabet,
): string {
  const nanoid = customAlphabet(alphabet, length);
  return prefix + nanoid(); // example => "Iy1Q86plt1T2I1CFvAKQL"
}

/**
 * Check if password meets the criteria: at least two of numbers, English letters, or English symbols
 */
export function meetPwdCriteria(password: string): boolean {
  const numbers = /[0-9]/;
  const letters = /[a-zA-Z]/;
  const symbols = /[!@#$%^&*()]/;

  const typesIncluded = [numbers, letters, symbols].reduce(
    (acc, regex) => (regex.test(password) ? acc + 1 : acc),
    0,
  );

  return typesIncluded >= 2;
}

/**
 * Generate a random password with the following rules:
 * 1. Length of 8-18 characters
 * 2. Contains at least two of: numbers, English letters, or English symbols
 */
export function generatePassword(length: number): string {
  if (length < 8 || length > 18) {
    throw new Error("Password length must be between 8 and 18 characters.");
  }

  const numbers = "0123456789";
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const symbols = "!@#$%^&*()";
  const allChars = numbers + letters + symbols;

  // Ensure the password meets the criteria
  let password: string;
  do {
    password = customAlphabet(allChars, length)();
  } while (!meetPwdCriteria(password));

  return password;
}
