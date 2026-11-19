"use client";

import { useEffect, useState } from "react";
import Dashboard from "./dashboard";
import { api } from "./client-api";
import { Brand } from "./ui";

const headings = {
  in: "Sign in", up: "Create your account", verify: "Check your email",
  recover: "Reset your password", password: "Choose a new password",
};

export default function AccountGate({ initialMode = "in" }) {
  const [account, setAccount] = useState(undefined);
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(false);

  async function load() {
    setError("");
    try {
      const {payload} = await api("/api/account");
      setAccount(payload);
    } catch (err) {
      if (err.status === 401) {
        setAccount(null);
        if (initialMode === "password") {
          setMode("recover");
          setMessage("Request a new password reset link below.");
        }
      } else {
        setError("We could not open your account. Check your connection and try again.");
      }
    }
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).get("confirmation") === "failed") {
      setMode(initialMode === "password" ? "recover" : "in");
      setMessage(initialMode === "password"
        ? "That reset link has expired or has already been used. Request a new link below."
        : "That confirmation link could not be opened. Sign in if you have already confirmed, or request another email.");
    }
    load();
  }, []);

  useEffect(() => {
    if (!emailCooldown) return;
    const timer = setTimeout(() => setEmailCooldown(false), 60_000);
    return () => clearTimeout(timer);
  }, [emailCooldown]);

  function changeMode(next) {
    setMode(next);
    setError("");
    setMessage("");
  }

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (mode === "password" && password !== form.get("confirmPassword")) {
      setError("Your passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const {payload} = await api("/api/account", {action:mode, email, password});
      if (mode === "password") {
        location.replace("/");
      } else if (mode === "recover") {
        setEmailCooldown(true);
        setMessage("If an account uses this email, we’ll send a reset link. Open it in this browser to choose a new password.");
      } else if (payload.signedIn) {
        await load();
      } else {
        setMode("verify");
        setEmailCooldown(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      await api("/api/account", {action:"resend", email});
      setEmailCooldown(true);
      setMessage("Confirmation email requested. Check your inbox and spam folder.");
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
    setMode("in");
    setAccount(null);
  }

  if (account && mode !== "password" && mode !== "recover") {
    return <Dashboard account={account} signOut={signOut} onExpired={() => setAccount(null)} />;
  }
  const signup = mode === "up";
  const recovery = mode === "recover";
  const newPassword = mode === "password";
  const submitLabel = {
    in: "Sign in", up: "Create account", password: "Save new password",
    recover: emailCooldown ? "Check your inbox" : "Send reset link",
  }[mode];
  return <main className="auth-layout">
    <div className="box account-card">
      <Brand />
      {account === undefined ? <>
        <p role="status">{error ? "Your account could not be opened." : "Opening your account…"}</p>
        {error && <button type="button" className="primary-action" onClick={load}>Try again</button>}
      </> : <>
        <h1>{headings[mode]}</h1>
        {mode === "verify" ? <>
          <p>We’ve requested a confirmation email for <strong>{email}</strong>.</p>
          <p>Open the link in this browser, then return to DrySpool. Check your spam folder if it hasn’t arrived.</p>
          <div className="stack">
            <button type="button" className="primary-action" onClick={load} disabled={busy}>I’ve confirmed my email</button>
            <button type="button" className="textbutton" onClick={resend} disabled={busy || emailCooldown}>{emailCooldown ? "You can request another email in a minute" : "Resend confirmation email"}</button>
            <button type="button" className="textbutton" onClick={() => changeMode("up")} disabled={busy}>Use a different email</button>
          </div>
        </> : <>
          <p>{signup ? "Create one DrySpool account to connect your boxes and view readings on your phone or computer."
            : recovery ? "Enter your account email and we’ll send you a reset link."
            : newPassword ? "Use at least 8 characters. Your boxes will stay linked to your account."
            : "Check your boxes from your phone or computer."}</p>
          <form className="stack" onSubmit={submit} key={mode}>
            {!newPassword && <label>Email<input name="email" type="email" autoComplete="email" autoCapitalize="none" value={email} onChange={event => setEmail(event.target.value)} required /></label>}
            {!recovery && <label>{newPassword ? "New password" : "Password"}<input name="password" type="password"
              aria-label={newPassword ? "New password" : "Password"} aria-describedby={signup ? "password-help" : undefined}
              minLength={signup || newPassword ? 8 : undefined}
              autoComplete={signup || newPassword ? "new-password" : "current-password"} required />
              {signup && <span id="password-help" className="field-hint">At least 8 characters</span>}
            </label>}
            {newPassword && <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></label>}
            <button className="primary-action" disabled={busy || recovery && emailCooldown}>
              {busy ? "Please wait…" : submitLabel}
            </button>
          </form>
          {mode === "in" && <>
            <button type="button" className="textbutton" onClick={() => changeMode("recover")} disabled={busy}>Forgot password?</button>
            <button type="button" className="textbutton" onClick={() => changeMode("verify")} disabled={busy || !email.trim()}>Resend confirmation email</button>
          </>}
        </>}
        {!newPassword && <button className="textbutton auth-switch" type="button" disabled={busy} onClick={() => changeMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New to DrySpool? Create an account" : "Back to sign in"}
        </button>}
      </>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="notice">{error}</p>}
    </div>
  </main>;
}
