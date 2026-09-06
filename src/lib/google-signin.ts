export function isGoogleSignInEnabled() {
    return process.env.MULTITENANT_AUTH_ENABLED === "true"
        && process.env.GOOGLE_SIGNIN_ENABLED === "true"
        && Boolean(process.env.GOOGLE_CLIENT_ID?.trim())
        && Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
}
