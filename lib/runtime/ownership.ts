/** One extension instance binds once. Host replacement/reload creates a fresh instance. */
export class RuntimeOwnership {
  private state: "unbound" | "owned" | "closed" = "unbound";
  private owner: string | null = null;
  private revision = 0;

  get generation(): number { return this.revision; }
  owns(id: string | null): boolean { return this.state === "owned" && id !== null && id === this.owner; }
  start(id: string | null): void {
    if (!id || this.state === "closed") return;
    if (this.state === "unbound") { this.owner = id; this.state = "owned"; }
    if (this.owns(id)) this.revision++;
  }
  invalidate(id: string | null): void { if (this.owns(id)) this.revision++; }
  shutdown(id: string | null): void {
    if (!this.owns(id)) return;
    this.revision++;
    this.state = "closed";
  }
}
