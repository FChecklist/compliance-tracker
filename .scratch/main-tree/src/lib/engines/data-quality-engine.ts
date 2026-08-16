// VCEL Data Quality Engine (computation_engines: pan_validation_engine,
// gstin_validation_engine, ifsc_validation_engine, email/phone/bank-account/
// address). India-specific format + check-digit validators are hand-rolled
// (deterministic, well-documented algorithms with no suitable npm package);
// generic email/phone validation uses standard npm libraries per project
// convention rather than hand-rolled regex.
import isEmail from "validator/lib/isEmail"
import { parsePhoneNumberFromString } from "libphonenumber-js"

// PAN: AAAAA9999A (5 letters, 4 digits, 1 letter). No public check-digit
// algorithm is published by the Income Tax Department -- format is the
// verifiable part; true validity requires the ITD API (out of scope here).
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export function isValidPanFormat(pan: string): boolean {
  return PAN_REGEX.test(pan?.trim().toUpperCase() ?? "")
}

// GSTIN: 15 chars = 2-digit state code + PAN (10) + 1 entity code + 1 'Z'
// (fixed) + 1 checksum, computed via a mod-36 algorithm over a fixed
// character set (0-9, A-Z), same as published in the GSTN technical spec.
const GSTIN_FORMAT_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function isValidGstinFormat(gstin: string): boolean {
  return GSTIN_FORMAT_REGEX.test(gstin?.trim().toUpperCase() ?? "")
}

export function isValidGstinChecksum(gstin: string): boolean {
  const g = gstin?.trim().toUpperCase() ?? ""
  if (!isValidGstinFormat(g)) return false

  const factor = [1, 2]
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARSET.indexOf(g[i])
    if (code === -1) return false
    const product = code * factor[i % 2]
    sum += Math.floor(product / 36) + (product % 36)
  }
  const checkCodeValue = (36 - (sum % 36)) % 36
  return GSTIN_CHARSET[checkCodeValue] === g[14]
}

export function isValidGstin(gstin: string): boolean {
  return isValidGstinChecksum(gstin)
}

// IFSC: 11 chars = 4-letter bank code + '0' (reserved) + 6-char branch code.
// No public checksum is published (unlike PAN/GSTIN) -- format + reserved
// 5th-char check is the verifiable part; true validity requires the RBI list.
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

export function isValidIfscFormat(ifsc: string): boolean {
  return IFSC_REGEX.test(ifsc?.trim().toUpperCase() ?? "")
}

// Email Validation Engine -- validator.js (RFC 5322-aware) rather than hand-rolled regex
export function isValidEmail(email: string): boolean {
  return isEmail(email?.trim() ?? "")
}

// Phone Validation Engine -- libphonenumber-js, the standard for real international phone validation
export function isValidPhoneNumber(phone: string, defaultCountry: string = "IN"): boolean {
  const parsed = parsePhoneNumberFromString(phone ?? "", defaultCountry as never)
  return parsed?.isValid() ?? false
}

// Bank Account Validation Engine -- format-only (Indian bank account numbers
// are 9-18 digits, no universal checksum across banks); real validation
// requires a penny-drop/bank-API verification, out of scope for a pure function.
export function isValidBankAccountFormat(accountNumber: string): boolean {
  return /^[0-9]{9,18}$/.test(accountNumber?.trim() ?? "")
}

// Address Standardization Engine -- normalizes whitespace/casing only; true
// standardization (canonical city/state/pincode resolution) requires a
// postal API/database, out of scope for a pure deterministic function.
export function standardizeAddress(address: string): string {
  return address?.trim().replace(/\s+/g, " ").replace(/,\s*,/g, ",") ?? ""
}
