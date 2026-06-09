export class RecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordNotFoundError";
  }
}

export class MatchWatcherLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchWatcherLimitError";
  }
}
