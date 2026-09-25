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

export class OpggMatchParticipantMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpggMatchParticipantMismatchError";
  }
}

export class EventNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventNotFoundError";
  }
}

export class DomainConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainConflictError";
  }
}

export class RiotAccountNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiotAccountNotFoundError";
  }
}
