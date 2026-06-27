import { describe, expect, it } from "vitest";
import {
  defaultNanoIdAlphabet,
  defaultNanoIdAlphabetCount,
  generateNanoID,
  generatePassword,
  meetPwdCriteria,
} from "./nano-id";

describe("defaultNanoIdAlphabet", () => {
  it("should contain alphanumeric characters", () => {
    expect(defaultNanoIdAlphabet).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("should have 62 characters (10 digits + 26 upper + 26 lower)", () => {
    expect(defaultNanoIdAlphabet).toHaveLength(62);
  });
});

describe("defaultNanoIdAlphabetCount", () => {
  it("should return 62", () => {
    expect(defaultNanoIdAlphabetCount()).toBe(62);
  });
});

describe("generateNanoID", () => {
  it("should generate ID with default length of 21", () => {
    const id = generateNanoID();
    expect(id).toHaveLength(21);
  });

  it("should generate ID with prefix", () => {
    const id = generateNanoID("usr_");
    expect(id).toMatch(/^usr_[0-9A-Za-z]{21}$/);
    expect(id).toHaveLength(25); // 4 + 21
  });

  it("should generate ID with custom length", () => {
    const id = generateNanoID("", 16);
    expect(id).toHaveLength(16);
  });

  it("should generate ID with custom alphabet", () => {
    const id = generateNanoID("", 10, "abc");
    expect(id).toMatch(/^[abc]{10}$/);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateNanoID()));
    expect(ids.size).toBe(1000);
  });

  it("should only use characters from default alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateNanoID();
      expect(id).toMatch(/^[0-9A-Za-z]+$/);
    }
  });
});

describe("meetPwdCriteria", () => {
  it("should return true for password with numbers and letters", () => {
    expect(meetPwdCriteria("abc123")).toBe(true);
  });

  it("should return true for password with letters and symbols", () => {
    expect(meetPwdCriteria("abc!@#")).toBe(true);
  });

  it("should return true for password with numbers and symbols", () => {
    expect(meetPwdCriteria("123!@#")).toBe(true);
  });

  it("should return true for password with all three types", () => {
    expect(meetPwdCriteria("abc123!@#")).toBe(true);
  });

  it("should return false for password with only letters", () => {
    expect(meetPwdCriteria("abcdefgh")).toBe(false);
  });

  it("should return false for password with only numbers", () => {
    expect(meetPwdCriteria("12345678")).toBe(false);
  });

  it("should return false for password with only symbols", () => {
    expect(meetPwdCriteria("!@#$%^&*")).toBe(false);
  });
});

describe("generatePassword", () => {
  it("should generate password with specified length", () => {
    const password = generatePassword(12);
    expect(password).toHaveLength(12);
  });

  it("should generate password that meets criteria", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword(12);
      expect(meetPwdCriteria(password)).toBe(true);
    }
  });

  it("should throw error for length less than 8", () => {
    expect(() => generatePassword(7)).toThrow(
      "Password length must be between 8 and 18 characters",
    );
  });

  it("should throw error for length greater than 18", () => {
    expect(() => generatePassword(19)).toThrow(
      "Password length must be between 8 and 18 characters",
    );
  });

  it("should generate unique passwords", () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generatePassword(12)));
    expect(passwords.size).toBe(100);
  });

  it("should work at boundary lengths", () => {
    const pwd8 = generatePassword(8);
    const pwd18 = generatePassword(18);
    expect(pwd8).toHaveLength(8);
    expect(pwd18).toHaveLength(18);
    expect(meetPwdCriteria(pwd8)).toBe(true);
    expect(meetPwdCriteria(pwd18)).toBe(true);
  });
});
