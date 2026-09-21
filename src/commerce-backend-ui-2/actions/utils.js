/**
 * Returns an error response object, ready to be returned from an action's main function.
 * @param {number} statusCode the error status code, e.g. 400
 * @param {string} message the error message
 * @param {object} [logger] optional logger with an `info` method
 * @returns {object} the error response object
 */
export function errorResponse(statusCode, message, logger) {
  if (logger && typeof logger.info === "function") {
    logger.info(`${statusCode}: ${message}`);
  }
  return {
    error: {
      body: { error: message },
      statusCode,
    },
  };
}

/**
 * Masks a secret, keeping only its last 4 characters visible.
 * @param {string} [value] the secret to mask
 * @returns {string} the masked value, or "" if value is falsy
 */
export function maskSecret(value) {
  if (!value) {
    return "";
  }
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}
