export class PlayerProxy {
  private receive: (payload: string) => string;

  constructor(receive: (payload: string) => string) {
    this.receive = receive;
  }

  updateState(payload: string): string {
    return this.receive(payload);
  }
}
