// Process-scoped bounds for the official native CLI, including its own startup
// hydration and provider RPC. No SDK/factory/signing methods are replaced.
import { installNetworkBounds } from './worker.mjs';
installNetworkBounds({ signal: AbortSignal.timeout(45000) });
