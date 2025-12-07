### Our Open Source Philosophy: Gateway vs. Backend

We are committed to ensuring the open-source VaultSandbox Gateway is, and always will be, a powerful, secure, and complete tool for email testing. We want to be transparent about how we decide which features belong in the free Gateway versus the commercial Enterprise Backend.

Our decisions are guided by a clear architectural principle, not by a desire to limit the open-source version.

#### The Gateway: Powerful & Self-Contained

The open-source Gateway is designed to be a stateless, single-container application that is simple to deploy and manage. It adheres to two core rules:

1.  **Single Container, No Dependencies:** It will always run as a single Docker container and will never require an external database or other complex dependencies. This ensures it remains lightweight and easy for anyone to run.
2.  **Security is Non-Negotiable:** Core security features will never be removed or made optional. The Gateway is designed for maximum security by default.

Any feature that can be built within these constraints belongs in the open-source Gateway.

#### The Backend: For Scale & Governance

The Enterprise Backend is designed for features that, by their nature, require a more complex, stateful architecture. These are primarily organizational and governance features, such as:

*   Long-term data retention (requiring a database).
*   SSO, RBAC, and team management (requiring integration with identity providers).
*   Centralized audit trails and compliance policies.

The Gateway communicates with these systems via a well-defined API. Nothing prevents you or the community from building an alternative backend that implements this API.

**Our promise is simple:** We will never intentionally cripple the open-source Gateway or hold back features that fit its single-container architecture just to sell a license. The Gateway is not a "demo" — it's a production-ready tool. The Enterprise Backend is an optional, add-on component for organizations that need features that architecturally go beyond what a single, stateless container can provide.
