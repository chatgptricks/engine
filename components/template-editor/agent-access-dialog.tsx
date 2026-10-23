"use client";

import {useEffect, useState} from "react";
import {Modal} from "./controls";
import "./agent-access.css";

type Credential = {id: string; name: string; createdAt: string; expiresAt: string; revokedAt?: string};
async function accessRequest(method = "GET", body?: unknown, offset = 0) {
  const response = await fetch(`/api/agent/access${offset ? `?offset=${offset}` : ""}`, {method, cache: "no-store", headers: body ? {"Content-Type": "application/json"} : undefined, body: body ? JSON.stringify(body) : undefined});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Agent access is unavailable.");
  return result;
}
export function AgentAccessDialog({onClose}: {onClose: () => void}) {
  const [credentials, setCredentials] = useState<Credential[]>([]), [name, setName] = useState("My slide agent");
  const [created, setCreated] = useState<{token: string; credential: Credential} | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [origin, setOrigin] = useState("");
  const [now, setNow] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    accessRequest().then(result => {if (active) {setCredentials(result.credentials); setNextOffset(result.nextOffset ?? null); setNow(Date.now()); setOrigin(process.env.NEXT_PUBLIC_ENGINE_API_URL??window.location.origin);}}).catch(cause => {if (active) setError(cause.message);}).finally(() => {if (active) setBusy(false);});
    return () => {active = false;};
  }, []);
  async function create() {
    setBusy(true); setError(""); setNotice("");
    try {const result = await accessRequest("POST", {name}); setCreated(result); setCredentials(previous => [result.credential, ...previous]);}
    catch (cause) {setError(cause instanceof Error ? cause.message : "Could not connect this agent.");}
    finally {setBusy(false);}
  }
  async function revoke(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {await accessRequest("DELETE", {id}); setCredentials(previous => previous.map(item => item.id === id ? {...item, revokedAt: new Date().toISOString()} : item)); if (created?.credential.id === id) setCreated(null); setNotice("Agent access revoked");}
    catch (cause) {setError(cause instanceof Error ? cause.message : "Could not revoke access.");}
    finally {setBusy(false);}
  }
  async function copy(value: string) {
    try {await navigator.clipboard.writeText(value); setNotice("Copied");}
    catch {setNotice("Select the text to copy it");}
  }
  async function loadMore() {
    if (nextOffset === null) return;
    setBusy(true); setError("");
    try {
      const result = await accessRequest("GET", undefined, nextOffset);
      setCredentials(previous => [...new Map([...previous, ...result.credentials].map(credential => [credential.id, credential])).values()]);
      setNextOffset(result.nextOffset ?? null); setNow(Date.now());
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Could not load connections.");}
    finally {setBusy(false);}
  }
  const config = JSON.stringify({mcpServers: {engine: {command: "node", args: ["/absolute/path/to/engine-agent-mcp.mjs"], env: {ENGINE_URL: origin, ENGINE_AGENT_TOKEN: created?.token ?? "YOUR_ENGINE_TOKEN"}}}}, null, 2);
  return <Modal title="Connect an AI agent" onClose={onClose}>
    <div className="te-agent-access">
      <p>Let your agent build and revise slides in this workspace. Text, photos, shapes, and layers stay editable in Engine.</p>
      <div className="te-agent-endpoint"><span>Agent API</span><code>{origin}/api/agent/slides</code><button className="te-text-button" onClick={() => void copy(`${origin}/api/agent/slides`)}>Copy</button></div>
      <form onSubmit={event => {event.preventDefault(); void create();}} className="te-agent-create">
        <label className="te-field">Agent name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Codex" /></label>
        <button className="te-button te-primary" disabled={busy || !name.trim()}>Create access token</button>
      </form>
      {created && <section className="te-agent-created" aria-label="New agent connection">
        <h3>Your agent is ready to connect</h3>
        <p>Copy this token now. It appears once and expires in 30 days. It can read and edit slides in this workspace.</p>
        <div className="te-agent-secret"><input aria-label="Agent access token" readOnly value={created.token} onFocus={event => event.currentTarget.select()} /><button className="te-button" onClick={() => void copy(created.token)}>Copy token</button></div>
        <details open><summary>Connect through MCP</summary>
          <p><a href="/api/agent/bridge" download="engine-agent-mcp.mjs" onClick={event=>{if(!process.env.NEXT_PUBLIC_ENGINE_API_URL)return;event.preventDefault();void (async()=>{try{const response=await fetch("/api/agent/bridge");if(!response.ok)throw Error("Sign in to download the agent bridge.");const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");link.href=url;link.download="engine-agent-mcp.mjs";link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(cause){setError(cause instanceof Error?cause.message:"Download failed.");}})();}}>Download the MCP bridge</a>, then replace its absolute path in this configuration. Add it to your agent’s MCP settings. Requires Node.js 22.</p>
          <textarea aria-label="MCP configuration" readOnly rows={12} value={config} onFocus={event => event.currentTarget.select()} spellCheck={false} />
          <button className="te-button" onClick={() => void copy(config)}>Copy MCP configuration</button>
        </details>
        <p className="te-agent-prompt">Try: “Use Engine to create a five-slide presentation about our product. Keep every element editable and give me the editor link.”</p>
      </section>}
      {error && <p role="alert" className="te-agent-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Agent connections"><h3>Connections</h3>
        {busy && credentials.length === 0 ? <p role="status">Loading connections…</p> : credentials.length === 0 ? <p>No agents connected yet</p> : <ul className="te-agent-connections">{credentials.map(credential => {
          const inactive = Boolean(credential.revokedAt) || Date.parse(credential.expiresAt) <= now;
          return <li key={credential.id}><div><strong>{credential.name}</strong><small>{credential.revokedAt ? "Revoked" : `${inactive ? "Expired" : "Expires"} ${new Date(credential.expiresAt).toLocaleDateString()}`}</small></div>{!inactive && <button className="te-button" disabled={busy} onClick={() => void revoke(credential.id)}>Revoke</button>}</li>;
        })}</ul>}
        {nextOffset !== null && <button className="te-button" disabled={busy} onClick={() => void loadMore()}>Load more connections</button>}
      </section>
    </div>
  </Modal>;
}
