"use client";

import { useEffect, useState } from "react";
import Dashboard from "./dashboard";
import { api } from "./client-api";

export default function AccountGate() {
  const [account, setAccount] = useState(undefined);
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const {payload} = await api("/api/account");
      setAccount(payload);
    } catch (err) {
      setAccount(null);
      if (err.status !== 401) setError(err.message);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).get("confirmation") === "failed") {
      setMessage("Open the confirmation email again or sign in if your email is already confirmed.");
    }
    load();
  }, []);

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const {payload} = await api("/api/account", {
        action: signup ? "up" : "in", email: form.get("email"), password: form.get("password"),
      });
      if (payload.signedIn) await load();
      else setMessage("Check your email to confirm your account, then sign in.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await api("/api/account", {action:"out"});
    setError("");
    setMessage("");
    setAccount(null);
  }

  if (account) {
    return <Dashboard account={account} signOut={signOut} onExpired={() => setAccount(null)} />;
  }
  return <main className="auth-layout">
    <div className="box account-card">
      <div className="brand"><img alt="" width="36" height="36" src="/icon-192.png" />DrySpool</div>
      {account === undefined ? <p role="status">Opening your account…</p> : <>
        <h1>{signup ? "Create your account" : "Sign in"}</h1>
        <p>Use the same account in the DrySpool Setup app and this dashboard.</p>
        <form className="stack" onSubmit={submit}>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input key={String(signup)} name="password" type="password"
            autoComplete={signup ? "new-password" : "current-password"} required /></label>
          <button className="primary-action" disabled={busy}>{signup ? "Create account" : "Sign in"}</button>
        </form>
        <button className="textbutton" type="button" onClick={() => {setSignup(!signup); setError("");}}>
          {signup ? "Already have an account? Sign in" : "New to DrySpool? Create an account"}
        </button>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert" className="notice">{error}</p>}
      </>}
    </div>
  </main>;
}
