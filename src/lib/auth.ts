import { cookies } from "next/headers";

const PASSWORD = process.env.CHATMIO_PASSWORD ?? "";
const AUTH_COOKIE = "chatmio-authenticated";

export function isPasswordValid(password: string) {
  return Boolean(PASSWORD) && password === PASSWORD;
}

export async function isAuthenticated() {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE)?.value === "true";
}

export async function setAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "true", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
}
