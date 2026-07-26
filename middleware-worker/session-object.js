import { newSession, recordTurn } from "./sessions.js";

/**
 * Durable Object holding one conversation's state.
 *
 * One instance per session id, addressed via idFromName(sessionId). The
 * runtime serialises requests to a given instance, which is the point: the
 * read-modify-write in /record happens with no other turn interleaving, so
 * crisisTurnCount cannot lose an increment.
 *
 * It reuses recordTurn from sessions.js rather than reimplementing the
 * bookkeeping, so the durable and in-memory paths cannot drift apart — the
 * history caps and counter rules are defined once.
 *
 *   GET  /         -> the stored session, or null if this is a new conversation
 *   POST /record   -> apply one completed turn, return the updated session
 */
export class SessionObject {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/record" && request.method === "POST") {
      const delta = await request.json();
      // blockConcurrencyWhile keeps the read, mutate, and write together as
      // one unit even against the object's own re-entrancy.
      const updated = await this.state.blockConcurrencyWhile(async () => {
        const session = (await this.state.storage.get("session")) ?? newSession();
        recordTurn(session, delta);
        await this.state.storage.put("session", session);
        return session;
      });
      return Response.json(updated);
    }

    if (url.pathname === "/" && request.method === "GET") {
      return Response.json((await this.state.storage.get("session")) ?? null);
    }

    return new Response("not found", { status: 404 });
  }
}
