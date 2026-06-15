import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public: auth pages and the token-authenticated ingest/worker endpoints.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/ingest", "/api/worker"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|svg|ico)).*)", "/(api|trpc)(.*)"],
};
