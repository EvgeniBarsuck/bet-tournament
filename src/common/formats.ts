/** Wire formats shared by events, the X-Player-Id header and the rate config. */

/** betId and playerId. */
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** ISO 4217-style currency code. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Non-negative decimal string, up to 12 integer and 8 fractional digits. Never a JS number. */
export const DECIMAL_PATTERN = /^\d{1,12}(\.\d{1,8})?$/;

/** A decimal string is positive if it has at least one non-zero digit. */
export const NON_ZERO_DIGIT = /[1-9]/;
