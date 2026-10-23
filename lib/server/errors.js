class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new ApiError(400, "bad_request", message);
const unauthorized = (message = "Sign in with your wallet first") =>
  new ApiError(401, "unauthorized", message);
const forbidden = (message) => new ApiError(403, "forbidden", message);
const tooMany = (message) => new ApiError(429, "rate_limited", message);

module.exports = { ApiError, badRequest, unauthorized, forbidden, tooMany };
