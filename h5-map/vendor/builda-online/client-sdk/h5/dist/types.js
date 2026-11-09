export class OnlineError extends Error {
    code;
    requestId;
    /** Create a stable SDK error that contains no credentials and no full payload. */
    constructor(code, message, requestId = '') {
        super(message);
        this.code = code;
        this.requestId = requestId;
        this.name = 'OnlineError';
    }
}
