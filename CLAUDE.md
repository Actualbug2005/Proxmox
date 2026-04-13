# Role: Senior Full-Stack Engineer & Proxmox Systems Architect
# Project: "Nexus" - Modern Proxmox Management Overlay

## High-Level Objective
Build a modern web-based management interface for Proxmox VE. This application will run inside a privileged LXC container on a Proxmox host. It must provide a superior UX compared to the legacy ExtJS interface while maintaining 1:1 functional parity for core operations and adding a "Community Scripts" marketplace.

## Design Philosophy (Untitled UI)
- Framework: Next.js 14+ (App Router), Tailwind CSS.
- Aesthetics: High-contrast, minimalist, "Untitled UI" inspired. Use Lucide-react for iconography.
- UX: Fast context switching, modular dashboard widgets, and a global Command Palette (CMD+K).

## Technical Requirements & Backend Logic
1. **Authentication:**
   - Implement login using Proxmox credentials (PAM/PVE).
   - The backend proxy must manage the `PVEAuthCookie` and `CSRFPreventionToken`.
   - Ensure the app is "Cluster Aware": fetch resource trees from `/cluster/resources`.

2. **The API Proxy Layer:**
   - Create a dynamic route `/api/proxmox/[...path]` that forwards requests to the host's API (`https://localhost:8006`).
   - Must handle `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed PVE certs.
   - Mechanism: Map GET/POST/PUT/DELETE verbs strictly to the PVE API.

3. **noVNC Integration:**
   - Provide a functional terminal/console component.
   - Method: Securely embed the Proxmox `vnc.html` via an iframe or use `xterm.js` to hook into the Proxmox websocket VNC proxy.

4. **Community Scripts (Tteck/Community-Scripts.org):**
   - Create a dedicated "Automation" tab.
   - Fetch/Parse the script library from the community-scripts GitHub repository.
   - Implementation: Provide a UI to select a Node and Target Storage, then execute the script via the Proxmox API's execution endpoint.

5. **Resource Telemetry:**
   - Use TanStack Query for high-frequency polling.
   - Visualize Node/VM/CT metrics (CPU, RAM, Net, Disk) using Tremor or Recharts.

## Architecture Instruction
- DO NOT assume x64 architecture; ensure the code is architecture-agnostic for ARM64/x64 clusters.
- Code must be modular (ADHD-friendly): separate API logic, UI components, and state hooks.
- Use strict TypeScript. Define interfaces for Proxmox API responses (Nodes, VMs, Storage, Tasks).

## Initial Deliverables
1. **Project Map:** A detailed directory structure.
2. **Core API Client:** A robust TypeScript fetch wrapper for Proxmox.
3. **Auth Middleware:** Logic for handling PVE tickets and CSRF tokens in Next.js.
4. **Dashboard Prototype:** A React component showing the "Resource Tree" and a "Node Status" card using Untitled UI styling.
5. **Script Runner:** A conceptual logic flow for executing remote shell scripts on a specific node via the API.