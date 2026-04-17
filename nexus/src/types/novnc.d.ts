/**
 * Minimal type shim for @novnc/novnc 1.5.x.
 *
 * The published package has no .d.ts files and no @types/ package exists.
 * We only use RFB here — a single default-export class — so a surgical
 * declaration covers every usage site without pulling in ambient globals.
 * If we ever start calling other novnc helpers, extend this file rather
 * than widening to `any` at the import site.
 */
declare module '@novnc/novnc/lib/rfb' {
  interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrSocket: string | WebSocket, options?: RFBOptions);
    disconnect(): void;
    sendCredentials(creds: { username?: string; password?: string; target?: string }): void;
    sendCtrlAltDel(): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;
    focus(): void;
    blur(): void;
    get capabilities(): { power: boolean };
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    viewOnly: boolean;
    focusOnClick: boolean;
    touchButton: number;
  }
}
