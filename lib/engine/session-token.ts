type SessionResult = {data: {session: {access_token: string} | null}; error: Error | null};
type SessionClient = {auth: {
  getSession(): Promise<SessionResult>;
  refreshSession(): Promise<SessionResult>;
}};

/** Share concurrent reads and refreshes instead of racing the browser auth lock. */
export function createSessionTokenReader(getClient: () => SessionClient | null) {
  let reading: Promise<string | null> | null = null;
  let refreshing: Promise<string | null> | null = null;
  return async (refresh = false): Promise<string | null> => {
    if (refreshing) return refreshing;
    if (!refresh && reading) return reading;
    const request = (async () => {
      if (refresh && reading) await reading.catch(() => null);
      const client = getClient();
      if (!client) return null;
      const result = await (refresh ? client.auth.refreshSession() : client.auth.getSession());
      if (result.error) throw result.error;
      return result.data.session?.access_token ?? null;
    })();
    if (refresh) refreshing = request;
    else reading = request;
    try { return await request; }
    finally {
      if (reading === request) reading = null;
      if (refreshing === request) refreshing = null;
    }
  };
}
