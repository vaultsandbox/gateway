/**
 * Development Environment Configuration
 *
 * This uses a proxy to avoid committing backend URLs to git.
 *
 * Setup: Create a `proxy.conf.json` file in the project root:
 
{
  "/api": {
    "target": "https://your-backend-url.com/api",
    "secure": true,
    "changeOrigin": true,
    "pathRewrite": { "^/api": "" }
  }
}
 
 * Replace "https://your-backend-url.com/api" with your backend URL.
 * The proxy.conf.json file is gitignored.
 */
export const environment = {
  apiUrl: '/api',
};
