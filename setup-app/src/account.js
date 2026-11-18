import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const dashboard = process.env.EXPO_PUBLIC_DASHBOARD_URL;
const https = url && key && dashboard && [url,dashboard].every(value => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
});

export const dashboardUrl = https ? new URL("/",dashboard).href : null;
export const auth = https ? createClient(url,key,{
  auth:{
    persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, lock:processLock,
    storage:{getItem:SecureStore.getItemAsync,setItem:SecureStore.setItemAsync,
      removeItem:SecureStore.deleteItemAsync},
  },
}).auth : null;

export async function request(path, {body,signal} = {}) {
  if (signal?.aborted) throw new Error("Setup cancelled.");
  const {data} = await auth.getSession();
  if (!data?.session?.access_token) throw new Error("Sign in again to continue.");
  const timeout = new AbortController();
  const cancel = () => timeout.abort();
  signal?.addEventListener("abort",cancel,{once:true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel,15_000);
  try {
    const response = await fetch(new URL(path,dashboardUrl).href,{
      method:body === undefined ? "GET" : "POST",
      headers:{authorization:"Bearer "+data.session.access_token,"content-type":"application/json"},
      body:body === undefined ? undefined : JSON.stringify(body),
      signal:timeout.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(payload.error || "Try again in a moment."),{status:response.status});
    }
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort",cancel);
  }
}
