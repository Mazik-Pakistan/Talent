import { NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/set-password",
  "/verify-email",
  "/invite",
  "/onboarding",
  "/documents",
  "/offer",
  "/it-setup",
  "/it-support",
  "/portal-root-x9f3",
  "/_next",
  "/favicon.ico",
]);

function isPublicPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  for (const prefix of PUBLIC_PATHS) {
    if (prefix !== "/_next" && prefix !== "/favicon.ico" && pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get("access_token")?.value;

  if (!accessToken && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|images|public).*)"],
};
