import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public at the middleware level:
//  - auth pages
//  - ALL /api/* routes self-authenticate via resolveAuth (they return their own 401 JSON,
//    not an HTML redirect), so the middleware must not gate them.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  // Protected pages: send signed-out visitors to our sign-in page (clerk's auth.protect()
  // returns 404 here rather than redirecting, so we redirect explicitly).
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|svg|ico)).*)", "/(api|trpc)(.*)"],
};
